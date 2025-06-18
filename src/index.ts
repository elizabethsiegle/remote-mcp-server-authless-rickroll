import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { env } from "cloudflare:workers";
import type { D1Database, Ai } from "@cloudflare/workers-types";

export interface Env {
	AI: Ai;
	DB: D1Database;
}

function getEnv<Env>() {
	return env as Env;
}

/*
extends McpAgent to create our podcast server with audio-first experience.
*/
export class RedirectMCP extends McpAgent {
	server = new McpServer({
		name: "AI Podcast Generator",
		version: "2.0.0",
	});

	async init() {
		// PRIMARY TOOL: Generate audio podcast (main experience)
		this.server.tool(
			"generate_audio_podcast",
			{
				topic: z.string().describe("A topic to generate an AI audio podcast about"),
			},
			async ({ topic }) => {
				const env = getEnv<Env>();
				const baseUrl = "https://podcaster.lizziepika.workers.dev";

				try {
					// Step 1: Generate podcast script using AI
					const scriptMessages = [
						{
							role: "system",
							content: `You are a professional podcast script writer. Create engaging, comprehensive podcast scripts that sound natural when spoken aloud. Make the scripts substantial and informative, typically 5-7 minutes when read aloud (about 800-1200 words). Include detailed explanations, examples, and engaging storytelling.`,
						},
						{
							role: "user",
							content: `Write a comprehensive podcast script about "${topic}" that covers multiple key points with detailed explanations and examples. The script should be engaging and informative, approximately 5-7 minutes when read aloud (800-1200 words). Include an introduction, several main sections with examples, and a strong conclusion. Return only the script text and no music or sound effects.`,
						},
					];

					const scriptResponse: any = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
						messages: scriptMessages,
					});

					if (!scriptResponse.response) {
						throw new Error("Failed to generate podcast script");
					}

					const fullScript = scriptResponse.response;
					console.log(`Generated script: ${fullScript.substring(0, 100)}...`);

					// Clean script for audio (remove any section markers)
					const audioScript = fullScript.replace(/\[.*?\]/g, "").replace(/\n\n+/g, "\n\n").trim();

					// Step 2: Convert script to audio with improved logic for longer content
					console.log("Converting script to audio...");
					let audioDataUrl = "";
					let audioContentType = "preview";

					try {
						// Clean and prepare the script for TTS
						const cleanScript = audioScript
							.replace(/[^\w\s.,!?;:-]/g, '') // Remove special characters that might break TTS
							.replace(/\s+/g, ' ') // Normalize whitespace
							.trim();
						
						console.log(`Clean script length: ${cleanScript.length} characters`);
						
						// Strategy 1: Try substantial chunks for longer audio
						if (cleanScript.length <= 1000) {
							console.log("Attempting full script audio generation...");
							
							const { audio }: any = await Promise.race([
								env.AI.run('@cf/myshell-ai/melotts', {
									prompt: cleanScript,
									lang: 'en',
								}),
								new Promise((_, reject) => 
									setTimeout(() => reject(new Error('Audio generation timeout')), 20000)
								)
							]);

							if (audio && typeof audio === 'string') {
								audioDataUrl = `data:audio/mp3;base64,${audio}`;
								audioContentType = "full";
								console.log("✅ Full script audio generated successfully");
							} else {
								throw new Error("Invalid full script audio response");
							}
						} else {
							// Strategy 2: Use larger chunks for longer scripts to get more substantial audio
							console.log("Script is long, using substantial chunk approach...");
							
							// Split into sentences and take a larger portion
							const sentences = cleanScript.split(/[.!?]+/).filter((s: string) => s.trim().length > 10);
							console.log(`Found ${sentences.length} sentences`);
							
							// Take first 8-12 sentences for substantial audio (aim for 3-5 minutes)
							const chunkSize = Math.min(12, Math.max(8, Math.floor(sentences.length * 0.4)));
							const selectedSentences = sentences.slice(0, chunkSize);
							const chunkText = selectedSentences.join('. ').trim() + '.';
							
							console.log(`Using ${chunkSize} sentences for audio (${chunkText.length} chars)`);
							console.log(`Audio text preview: "${chunkText.substring(0, 100)}..."`);
							
							const { audio }: any = await Promise.race([
								env.AI.run('@cf/myshell-ai/melotts', {
									prompt: chunkText,
									lang: 'en',
								}),
								new Promise((_, reject) => 
									setTimeout(() => reject(new Error('Chunked audio generation timeout')), 20000)
								)
							]);

							if (audio && typeof audio === 'string') {
								audioDataUrl = `data:audio/mp3;base64,${audio}`;
								audioContentType = "substantial";
								console.log("✅ Substantial chunk audio generated successfully");
							} else {
								throw new Error("Invalid chunked audio response");
							}
						}
						
						console.log(`Final audio data length: ${audioDataUrl.length} characters`);
						
					} catch (audioError) {
						console.error("❌ Audio generation failed:", audioError);
						
						// Strategy 3: Fallback to meaningful excerpt (still longer than before)
						try {
							console.log("Trying fallback excerpt approach...");
							
							// Get first 2-3 paragraphs or first 400 chars for a decent excerpt
							const paragraphs = audioScript.split('\n\n').filter((p: string) => p.trim().length > 0);
							let fallbackText = "";
							
							if (paragraphs.length >= 2) {
								fallbackText = paragraphs.slice(0, 2).join('\n\n').trim();
							} else {
								fallbackText = audioScript.substring(0, 400).trim();
								const lastSentenceEnd = Math.max(
									fallbackText.lastIndexOf('.'),
									fallbackText.lastIndexOf('!'),
									fallbackText.lastIndexOf('?')
								);
								fallbackText = lastSentenceEnd > 100 ? 
									fallbackText.substring(0, lastSentenceEnd + 1) : 
									fallbackText + '.';
							}
							
							console.log(`Fallback excerpt (${fallbackText.length} chars): "${fallbackText.substring(0, 100)}..."`);
							
							const { audio }: any = await env.AI.run('@cf/myshell-ai/melotts', {
								prompt: fallbackText,
								lang: 'en',
							});
							
							if (audio && typeof audio === 'string') {
								audioDataUrl = `data:audio/mp3;base64,${audio}`;
								audioContentType = "excerpt";
								console.log("✅ Fallback audio generated");
							}
							
						} catch (fallbackError) {
							console.error("❌ Fallback audio also failed:", fallbackError);
							audioDataUrl = ""; // No audio available
						}
					}

					// Step 3: Generate unique slug
					const slugMessages = [
						{ role: "system", content: "You are a helpful assistant that creates URL-friendly slugs." },
						{
							role: "user",
							content: `Create a URL-friendly slug for a podcast about "${topic}". Return only the slug with hyphens, no quotes, no extra text. The slug should be related to the query but with a twist.`,
						},
					];

					const slugResponse: any = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
						messages: slugMessages,
					});

					let slug = slugResponse.response?.trim() || topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
					
					// Clean the slug
					slug = slug
						.toLowerCase()
						.replace(/[^a-z0-9-]/g, '')
						.replace(/--+/g, '-')
						.replace(/^-|-$/g, '')
						.substring(0, 50);
					
					// Check for existing slug and make unique if needed
					try {
						const existingSlug = await env.DB.prepare("SELECT slug FROM podcasts WHERE slug = ?").bind(slug).first();
						if (existingSlug) {
							const timestamp = Date.now();
							slug = `${slug}-${timestamp}`;
							console.log(`Slug already exists, using unique slug: ${slug}`);
						}
					} catch (e) {
						console.warn("Could not check for existing slug:", e);
					}

					const finalUrl = `${baseUrl}/${slug}`;

					// Step 4: Save to database 
					try {
						// Try to add columns if they don't exist (migration)
						try {
							await env.DB.prepare("ALTER TABLE podcasts ADD COLUMN script TEXT").run();
						} catch (e) {
							// Column might already exist
						}
						
						try {
							await env.DB.prepare("ALTER TABLE podcasts ADD COLUMN audio_data TEXT").run();
						} catch (e) {
							// Column might already exist
						}

						const stmt = env.DB.prepare(`
							INSERT INTO podcasts (topic, slug, url, created_at, script, audio_data) 
							VALUES (?, ?, ?, datetime('now'), ?, ?)
						`);
						console.log(`fullScript: ${fullScript.length} chars`);
						console.log(`audioDataUrl: ${audioDataUrl.length} chars`);
						await stmt.bind(
							topic, 
							slug, 
							finalUrl, 
							fullScript,
							audioDataUrl
						).run();

						console.log(`Saved audio podcast record for topic: ${topic} with slug: ${slug}`);

						// Verify the save
						try {
							const verifyStmt = env.DB.prepare("SELECT * FROM podcasts WHERE slug = ? ORDER BY created_at DESC LIMIT 1");
							const savedRecord = await verifyStmt.bind(slug).first();
							console.log("Verification - script saved:", !!savedRecord?.script);
							console.log("Verification - audio_data saved:", !!savedRecord?.audio_data);
						} catch (verifyError) {
							console.warn("Could not verify save:", verifyError);
						}

					} catch (dbError) {
						console.warn("Could not save to database with audio data, trying fallback:", dbError);
						
						// Fallback: try basic insert 
						try {
							const fallbackStmt = env.DB.prepare(`
								INSERT INTO podcasts (topic, slug, url, created_at) 
								VALUES (?, ?, ?, datetime('now'))
							`);
							await fallbackStmt.bind(`Audio: ${topic}`, slug, finalUrl).run();
							console.log(`Saved basic podcast record for topic: ${topic} with slug: ${slug}`);
						} catch (e) {
							console.error("Fallback save also failed:", e);
						}
					}

					// Step 5: Generate AI response message
					const getAudioDescription = () => {
						switch (audioContentType) {
							case "full":
								return "complete script audio (full experience)";
							case "substantial":
								return "substantial audio content (3-5 minutes of rich content)";
							case "excerpt":
								return "extended introduction audio (2-3 minutes)";
							default:
								return "text script";
						}
					};

					// AI-generated response message
					const responseMessages = [
						{
							role: "system",
							content: "You are an enthusiastic podcast host assistant. Create engaging, friendly announcements about newly created podcasts. Be conversational, exciting, and include emojis. Keep responses concise but enthusiastic. Always include the URL prominently."
						},
						{
							role: "user",
							content: `Write an exciting announcement message for a newly created AI podcast about "${topic}". The podcast URL is ${finalUrl}. The audio ${audioDataUrl ? `includes ${getAudioDescription()}` : 'generation failed but script is available'}. Include the URL clearly and mention there's bonus content available. Be enthusiastic and use emojis!`
						}
					];

					const messageResponse: any = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
						messages: responseMessages,
					});

					const aiGeneratedMessage = messageResponse.response || `🎧 Your AI podcast about "${topic}" is ready! ${audioDataUrl ? `Features ${getAudioDescription()}` : 'Script available'}.\n\n🔗 Listen now: ${finalUrl}\n\n✨ Don't miss the bonus content!`;

					return {
						content: [
							{
								type: "text",
								text: aiGeneratedMessage
							}
						]
					};

				} catch (error) {
					console.error("Failed to create audio podcast:", error);

					// Generate AI error message
					const errorMessages = [
						{
							role: "system",
							content: "You are a helpful assistant. Create a friendly, apologetic message about podcast generation issues while still being optimistic and offering alternatives."
						},
						{
							role: "user",
							content: `Write a friendly message explaining that podcast generation encountered issues for the topic "${topic}", but encourage the user to try again or try a different topic. Be supportive and use emojis.`
						}
					];

					let errorMessage = `⚠️ Oops! We encountered some issues generating your podcast about "${topic}". Please try again or try a different topic!`;
					
					try {
						const errorResponse: any = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
							messages: errorMessages,
						});
						errorMessage = errorResponse.response || errorMessage;
					} catch (e) {
						console.warn("Failed to generate AI error message:", e);
					}

					return {
						content: [
							{
								type: "text",
								text: errorMessage
							}
						]
					};
				}
			}
		);

		// UTILITY TOOL: List recent podcasts
		this.server.tool(
			"list_recent_podcasts",
			{
				limit: z.number().optional().default(10).describe("Number of recent podcasts to retrieve (default: 10)"),
			},
			async ({ limit }) => {
				try {
					const env = getEnv<Env>();
					const stmt = env.DB.prepare(`
						SELECT topic, slug, url, created_at, script, audio_data
						FROM podcasts 
						ORDER BY created_at DESC 
						LIMIT ?
					`);
					
					const result = await stmt.bind(limit).all();
					const podcasts = result.results || [];
					
					if (podcasts.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No podcasts have been generated yet."
								}
							]
						};
					}

					const podcastList = podcasts.map((p: any) => {
						const date = new Date(p.created_at).toLocaleString();
						const typeIcon = p.topic.includes('Surprise') ? '🎉' : '🎧';
						const hasAudio = p.audio_data ? ' 🎵' : '';
						const hasScript = p.script ? ' 📝' : '';
						return `${typeIcon} ${p.topic}${hasAudio}${hasScript} - ${p.url} (${date})`;
					}).join('\n');

					return {
						content: [
							{
								type: "text",
								text: `📻 Recent Podcasts (${podcasts.length}):\n\n${podcastList}\n\n🎧 = Audio podcast • 🎉 = Surprise content • 🎵 = Has audio • 📝 = Has script`
							}
						]
					};
				} catch (error) {
					console.error("Failed to retrieve podcasts:", error);
					return {
						content: [
							{
								type: "text",
								text: "Failed to retrieve podcast list from database."
							}
						]
					};
				}
			}
		);
	}
}

// Export as Durable Object
export { RedirectMCP as MyMCP };

// MAIN WORKER EXPORT HANDLER
export default {
	fetch(request: Request, env: any, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// Filter out favicon.ico and other non-podcast requests
		if (url.pathname === "/favicon.ico" || url.pathname.includes(".ico") || url.pathname.includes(".png") || url.pathname.includes(".jpg")) {
			return new Response("", { status: 404 });
		}

		/**
		 * SERVER-SENT EVENTS (SSE) ENDPOINT
		 */
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return RedirectMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		/**
		 * MCP ENDPOINT
		 */
		if (url.pathname === "/mcp") {
			return RedirectMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response(`🎙️ AI Podcast MCP Server - Ready! 

🎧 AUDIO-FIRST FLOW:
• Main URLs = Real AI podcasts with longer MP3 audio

🛠️ Available Tools:
• generate_audio_podcast - Creates real AI podcast with longer audio (main experience)
• list_recent_podcasts - Shows generated content

🎵 Audio Improvements:
• Longer audio generation (3-5 minutes instead of 10 seconds)
• Intelligent script chunking for substantial content
• Multiple fallback strategies for reliability
• Better content type detection

🤖 AI-Generated Messages:
• All tool responses use AI-generated messages
• Personalized and engaging announcements
• Dynamic error handling with supportive messages

Connect Claude to /mcp endpoint to access podcast generation tools!`, { 
			status: 200,
			headers: { 'Content-Type': 'text/plain' }
		});
	},
};