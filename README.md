# joytree-mcp-server

The official JoyTree MCP server. Connect it once in Claude (or any other
MCP-compatible client) and a developer can deploy, manage databases, and
generate APIs on JoyTree just by asking — no CLI, no copy-pasting commands,
no leaving the chat.

This exists because Claude's own sandboxed code environment (claude.ai
chat) has a fixed, restrictive network allowlist and cannot reach
`joytree.site` directly. This server sidesteps that entirely: it's
infrastructure *JoyTree* hosts, so when Claude calls one of its tools, the
request goes to this server (not through Claude's sandbox), and this server
talks to the real JoyTree API with no restrictions at all.

Claude Code (which runs on a developer's own machine, not in a sandbox)
doesn't need this — the existing `joytree` CLI already works there directly.
This server is specifically what makes the same experience possible from
claude.ai chat, Claude Cowork, or any other MCP client that can't run local
processes.

## What it exposes

18 tools covering the core "code with Claude, ship it" loop:

- **Identity & projects** — `joytree_whoami`, `joytree_list_projects`, `joytree_get_project`, `joytree_delete_project`
- **Deploy** — `joytree_deploy_from_github`, `joytree_list_deployments`, `joytree_runtime_logs`, `joytree_list_github_repos`
- **Environment variables** — `joytree_env_list`, `joytree_env_set`, `joytree_env_delete`
- **Databases** — `joytree_list_databases`, `joytree_create_database`, `joytree_get_database`, `joytree_database_lifecycle`
- **Realtime API Builder** — `joytree_create_api_from_prompt`, `joytree_list_generated_apis`, `joytree_dockerize_api`

Most read/lookup tools call JoyTree's versioned `/api/v1/*` surface rather
than the older internal `/api/*` routes — the v1 API resolves projects by
either id *or* subdomain and doesn't throw on non-ObjectId project ids
(most projects here use custom string ids, not real Mongo ObjectIds),
so it's the more robust surface for exactly this kind of external tool
use. `joytree_delete_project` is the one deliberate exception — it stays
on the original `/api/projects/:id` endpoint, since that one does full
cleanup (site files, container, DNS route) where v1's delete only removes
the workspace record.

## Auth

Two ways to authenticate, both supported at once:

**OAuth (what Claude's "Add custom connector" UI actually uses)** — this
server is a full OAuth 2.1 authorization server (`/authorize`, `/token`,
`/register`, `/revoke`, plus the standard metadata discovery endpoints).
"Logging in" means a one-time form asking for your JoyTree API key (since
JoyTree itself has no separate OAuth login, only jtk_ keys) — the key is
verified against the real API once, then wrapped in a normal OAuth
access/refresh token pair. From that point on, Claude only ever sees an
opaque OAuth token; your raw API key is never exposed to it again.

**Direct API key** — for anyone scripting against this server without
going through OAuth (curl, a different MCP client), send your key straight
as a bearer token:

```
Authorization: Bearer jtk_xxxxxxxxxxxxxxxxxxxx
```

Either way, every tool call is scoped to whichever key that specific
request resolved to. There is no shared/server-wide credential anywhere in
this service, and a fresh `McpServer` instance is built per request
(stateless mode), so there's no session state where one caller's context
could leak into another's.

OAuth state (registered clients, pending authorizations, access/refresh
tokens) is currently in-memory — a server restart logs everyone out, and
they just reconnect and paste their key again. Swapping that for
Redis/a database later is a contained change to `src/oauth-provider.js`
and wouldn't require touching the tool logic or the auth model at all.

## Running locally

```bash
npm install
npm start          # listens on :8787 (set PORT to change)
```

Point `JOYTREE_BASE_URL` at a different environment if needed (defaults to
`https://joytree.site`).

## Verifying it works

```bash
npm test
```

This starts the server and runs `test/protocol-check.js` against it — a
real MCP client that checks: an invalid/missing key is cleanly rejected,
a valid handshake correctly lists all 18 tools, and an actual tool call
makes it through the full pipeline (parse → auth → dispatch → real HTTP
call → clean error/result), not just that the server boots.

`test/oauth-flow-check.js` separately exercises the OAuth side: dynamic
client registration, the `/authorize` page rendering, and
`/authorize/submit` handling. `node test/oauth-flow-check.js` (with the
server already running) walks through it.

## Deploying

Container-based, same shape as JoyTree's own services — build the
`Dockerfile` and run it anywhere that can reach `joytree.site` (which is
anywhere except Claude's own sandboxed code environment — that's the
entire reason this exists). A `docker-compose.yml` alongside JoyTree's
main service, or its own small VPS/container, both work fine.

Once it's live at a public URL (e.g. `https://mcp.joytree.site/mcp`),
submit it to Anthropic's MCP directory so it shows up as a one-click
connector for any Claude user — the same way Vercel, Google Compute
Engine, and other platforms already have. It's also usable immediately as
a custom connector by URL before that, for anyone who wants to try it
early.
