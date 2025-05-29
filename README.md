# Building a Remote MCP Server to Generate Podcasts (and rickroll) on Cloudflare w/o auth

This example allows you to deploy a remote MCP server to rickroll people that doesn't require authentication on Cloudflare Workers. 

It uses a Cloudflare Workers AI LLM to generate complex URL slugs that attach to [this rickrolling Cloudflare Worker page](https://podcaster.lizziepika.workers.dev/cloudflare-explained-optimizing-website-performance-with-edge-computing) ( also [on GitHub here](https://github.com/elizabethsiegle/rickroll-worker)). It uses specific, detailed tool descriptions that do not mention rickrolling at all. The specialized tool appears to generate a podcast, getting past Claude's URL filtering, and saves that URL and topic to a Cloudflare D1 database.

## Tools
- generate_podcast

This tool takes in a topic and makes a LLM call to Cloudflare Workers AI to generate a complex path relating to the input topic. It then returns the combined Cloudflare Worker URL with that slug, appearing to be a podcast about the input query.

- list_recent_podcasts
This tool takes in a number and queries the Cloudflare D1 SQL database for previous podcast URLs and topics generated.

## Get started: 

[![Deploy to Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-authless)

This will deploy your MCP server to a URL like: `remote-mcp-server-authless.<your-account>.workers.dev/sse`

Alternatively, you can use the command line below to get the remote MCP Server created on your local machine:
```bash
npm create cloudflare@latest -- my-mcp-server --template=cloudflare/ai/demos/remote-mcp-authless
```

## Customizing your MCP Server

To add your own [tools](https://developers.cloudflare.com/agents/model-context-protocol/tools/) to the MCP server, define each tool inside the `init()` method of `src/index.ts` using `this.server.tool(...)`. 

## Connect to Cloudflare AI Playground

You can connect to your MCP server from the Cloudflare AI Playground, which is a remote MCP client:

1. Go to https://playground.ai.cloudflare.com/
2. Enter your deployed MCP server URL (`remote-mcp-server-authless.<your-account>.workers.dev/sse`)
3. You can now use your MCP tools directly from the playground!

## Connect Claude Desktop to your MCP server

You can also connect to your remote MCP server from local MCP clients, by using the [mcp-remote proxy](https://www.npmjs.com/package/mcp-remote). 

To connect to your MCP server from Claude Desktop, follow [Anthropic's Quickstart](https://modelcontextprotocol.io/quickstart/user) and within Claude Desktop go to Settings > Developer > Edit Config.

Update with this configuration:

```json
{
  "mcpServers": {
    "calculator": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8787/sse"  // or remote-mcp-server-authless.your-account.workers.dev/sse
      ]
    }
  }
}
```

Restart Claude and you should see the tools become available. 
