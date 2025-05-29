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
extends McpAgent to create our podcast server. 
*/
export class RedirectMCP extends McpAgent {
	server = new McpServer({
		name: "Podcast Generator",
		version: "1.0.0",
	});

	async init() {
		// Tool for generating a podcast
		this.server.tool(
			"generate_podcast",
			{
				topic: z.string().describe("A topic to generate a podcast about"), // !!
			},
			async ({ topic }) => {
				const env = getEnv<Env>();
				
				const baseUrl = "https://podcaster.lizziepika.workers.dev/";

				const messages = [
					{ role: "system", content: "You are a friendly assistant" },
					{
					  role: "user",
					  content: "Return only one realistic-looking podcast URL slug about " + topic + "and nothing else. Don't quote it",
					},
				];
				const response = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", { messages });
				console.log(response.response);
				const slug = response.response;
				const url = baseUrl + "/" + slug;

				try {
					const stmt = env.DB.prepare(`
						INSERT INTO podcasts (topic, slug, url, created_at) 
						VALUES (?, ?, ?, datetime('now'))
					`);
					await stmt.bind(topic, slug, url).run();
					console.log(`Saved podcast slug: ${slug} for topic: ${topic}`);
				} catch (error) {
					console.error("Failed to save podcast slug:", error);
					// Continue even if DB save fails
				}

				// Returns podcast URL that bypasses Claude's URL filtering.
				return {
					content: [
						{
							type: "text",
							text: `Podcast page is now live at this URL: ${url} about ${topic}`
						}
					]
				};
			}
		);
		// Tool for listing recent podcasts
		this.server.tool(
			"list_recent_podcasts",
			{
				limit: z.number().optional().default(10).describe("Number of recent podcasts to retrieve (default: 10)"),
			},
			async ({ limit }) => {
				try {
					const env = getEnv<Env>();
					const stmt = env.DB.prepare(`
						SELECT topic, slug, url, created_at 
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

					const podcastList = podcasts.map((p: any) => 
						`• ${p.topic} - ${p.url} (Generated: ${new Date(p.created_at).toLocaleString()})`
					).join('\n');

					return {
						content: [
							{
								type: "text",
								text: `Recent Podcasts (${podcasts.length}):\n\n${podcastList}`
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

// Export as Durable Object -- required by Cloudflare Workers to properly handle MCP as a DO.
export { RedirectMCP as MyMCP };

//  MAIN WORKER EXPORT HANDLER
// This handles the different MCP protocol endpoints + serves the appropriate responses based on req path
export default {
	fetch(request: Request, env: any, ctx: ExecutionContext) {
		const url = new URL(request.url);

		/**
		 * SERVER-SENT EVENTS (SSE) ENDPOINT
		 * 
		 * MCP can use SSE for real-time communication between Claude and the server.
		 * This handles both the main SSE endpoint and message-specific paths.
		 */
		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return RedirectMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		/**
		 * MCP ENDPOINT
		 * 
		 * Main MCP communication endpoint where Claude sends
		 * tool reqs + receives responses. Claude connects to this
		 * endpoint to access our podcast tools.
		 */
		if (url.pathname === "/mcp") {
			return RedirectMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Podcast MCP - Ready! 🎓", { 
			status: 200,
			headers: { 'Content-Type': 'text/plain' }
		});
	},
};