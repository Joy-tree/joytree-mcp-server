'use strict';

const { z } = require('zod');

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(err) {
  return {
    content: [{ type: 'text', text: `Error: ${err.message}` }],
    isError: true,
  };
}

/**
 * Registers every JoyTree tool on the given McpServer instance.
 * `getClient(extra)` must return a ready JoyTreeClient for the current
 * request (it reads the caller's API key out of the MCP request context).
 *
 * Every tool below carries explicit readOnlyHint/destructiveHint
 * annotations (required for MCP directory submission) rather than leaving
 * clients to guess: pure lookups are readOnlyHint:true; anything that
 * creates or updates a resource without destroying existing data is
 * readOnlyHint:false, destructiveHint:false; anything that can
 * permanently remove a resource is destructiveHint:true.
 */
function registerJoyTreeTools(server, getClient) {
  const tool = (name, config, handler) => {
    server.registerTool(name, config, async (args, extra) => {
      try {
        const client = getClient(extra);
        return await handler(args, client);
      } catch (err) {
        return errorResult(err);
      }
    });
  };

  // ── Identity ────────────────────────────────────────────────────────
  tool('joytree_whoami', {
    title: 'Who am I',
    description: 'Confirm the connected JoyTree account and API key scope. Use this first to verify the connection is working.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async (_args, client) => textResult(await client.get('/api/v1/account')));

  // ── Projects & deployments ─────────────────────────────────────────
  tool('joytree_list_projects', {
    title: 'List projects',
    description: 'List all of the current user\'s JoyTree projects, with status, live URL, and last deploy time.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async (_args, client) => textResult(await client.get('/api/v1/projects')));

  tool('joytree_get_project', {
    title: 'Get project details',
    description: 'Get full details for one project by its ID or subdomain (from joytree_list_projects).',
    inputSchema: { projectId: z.string().describe('The project ID or subdomain') },
    annotations: { readOnlyHint: true },
  }, async (args, client) => textResult(await client.get(`/api/v1/projects/${encodeURIComponent(args.projectId)}`)));

  tool('joytree_deploy_from_github', {
    title: 'Deploy a GitHub repo',
    description: 'Deploy a project straight from a GitHub repository. This is the main "ship it" tool — call this once code is pushed and ready to go live. Framework/build settings are auto-detected if omitted. If there is no repo to push to (e.g. a project generated locally with no git remote), use joytree_deploy_from_zip instead.',
    inputSchema: {
      name: z.string().describe('Project name — also becomes the <name>.joytree.site subdomain unless a custom subdomain is given'),
      repoUrl: z.string().describe('GitHub repository URL, e.g. https://github.com/you/my-app'),
      branch: z.string().optional().describe('Branch to deploy (default: main)'),
      subdomain: z.string().optional().describe('Custom subdomain, if different from the project name'),
      buildCmd: z.string().optional().describe('Override the auto-detected build command'),
      startCmd: z.string().optional().describe('Override the auto-detected start command (server apps only)'),
      outputDir: z.string().optional().describe('Override the auto-detected output directory'),
      siteType: z.enum(['static', 'server']).optional().describe('Force static vs. server app instead of auto-detecting'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post('/api/v1/deploy', {
    name: args.name,
    subdomain: args.subdomain || args.name,
    repoUrl: args.repoUrl,
    branch: args.branch || 'main',
    buildCmd: args.buildCmd,
    startCmd: args.startCmd,
    outputDir: args.outputDir,
    siteType: args.siteType,
  })));

  tool('joytree_deploy_from_zip', {
    title: 'Deploy from a zip archive (no repo needed)',
    description: 'Deploy a project directly from its files, base64-encoded as a zip archive — for cases where there is no GitHub repo to point at, e.g. a project you (the AI) just generated locally. Build/start commands and runtime are auto-detected from the archive contents if omitted, the same way joytree_deploy_from_github auto-detects from a cloned repo. Zip the project directory (excluding node_modules and other build artifacts), base64-encode the bytes, and pass that string as zipBase64. Archives over ~190MB pre-encoding (260MB after base64 inflation) will be rejected — for larger projects, push to GitHub and use joytree_deploy_from_github instead.',
    inputSchema: {
      name: z.string().describe('Project name — also becomes the <n>.joytree.site subdomain unless a custom subdomain is given'),
      zipBase64: z.string().describe('Base64-encoded bytes of a .zip archive containing the project files at its root (or a single top-level project folder)'),
      subdomain: z.string().optional().describe('Custom subdomain, if different from the project name'),
      buildCmd: z.string().optional().describe('Override the auto-detected build command'),
      startCmd: z.string().optional().describe('Override the auto-detected start command (server apps only)'),
      installCmd: z.string().optional().describe('Override the auto-detected install command'),
      outputDir: z.string().optional().describe('Override the auto-detected output directory (static sites only)'),
      siteType: z.enum(['static', 'server']).optional().describe('Force static vs. server app instead of auto-detecting'),
      nodeVer: z.string().optional().describe('Node.js version, e.g. "20" (default: 20, or whatever package.json engines specifies)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post('/api/v1/deploy-from-zip', {
    name: args.name,
    subdomain: args.subdomain || args.name,
    zipBase64: args.zipBase64,
    buildCmd: args.buildCmd,
    startCmd: args.startCmd,
    installCmd: args.installCmd,
    outputDir: args.outputDir,
    siteType: args.siteType,
    nodeVer: args.nodeVer,
  })));

  tool('joytree_list_deployments', {
    title: 'List deployment history',
    description: 'List recent deployments across all projects (or filter by project), with build status.',
    inputSchema: { projectId: z.string().optional().describe('Optionally scope to one project ID or subdomain') },
    annotations: { readOnlyHint: true },
  }, async (args, client) => {
    const qs = args.projectId ? `?projectId=${encodeURIComponent(args.projectId)}` : '';
    return textResult(await client.get(`/api/v1/deployments${qs}`));
  });

  tool('joytree_runtime_logs', {
    title: 'Get runtime logs',
    description: 'Fetch recent deployment/runtime log history for a project — use this to debug a live site or check a deploy actually worked.',
    inputSchema: { projectId: z.string().describe('The project ID or subdomain') },
    annotations: { readOnlyHint: true },
  }, async (args, client) => textResult(await client.get(`/api/v1/projects/${encodeURIComponent(args.projectId)}/logs`)));

  tool('joytree_delete_project', {
    title: 'Delete a project',
    description: 'Permanently delete a project — removes its site files, container, DNS route, and database record. Irreversible — confirm with the user before calling this.',
    inputSchema: { projectId: z.string().describe('The project ID to delete') },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (args, client) => textResult(await client.del(`/api/projects/${encodeURIComponent(args.projectId)}`)));

  // ── Environment variables ──────────────────────────────────────────
  tool('joytree_env_list', {
    title: 'List environment variables',
    description: 'List the environment variables set on a project (values are masked by default for security).',
    inputSchema: { projectId: z.string() },
    annotations: { readOnlyHint: true },
  }, async (args, client) => textResult(await client.get(`/api/v1/projects/${encodeURIComponent(args.projectId)}/env`)));

  tool('joytree_env_set', {
    title: 'Set environment variables',
    description: 'Set one or more environment variables on a project. Takes effect on the next deploy.',
    inputSchema: {
      projectId: z.string(),
      variables: z.record(z.string()).describe('Key/value pairs to set, e.g. { "DATABASE_URL": "postgres://..." }'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.put(`/api/v1/projects/${encodeURIComponent(args.projectId)}/env`, args.variables)));

  tool('joytree_env_delete', {
    title: 'Delete an environment variable',
    description: 'Remove a single environment variable from a project.',
    inputSchema: { projectId: z.string(), key: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (args, client) => textResult(await client.del(`/api/projects/${encodeURIComponent(args.projectId)}/env/${encodeURIComponent(args.key)}`)));

  // ── Databases ───────────────────────────────────────────────────────
  tool('joytree_list_databases', {
    title: 'List databases',
    description: 'List all managed databases in the account.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async (_args, client) => textResult(await client.get('/api/databases')));

  tool('joytree_create_database', {
    title: 'Create a database',
    description: 'Provision a new managed database (PostgreSQL, MySQL, MariaDB, MongoDB, or Redis).',
    inputSchema: {
      engine: z.enum(['postgres', 'mysql', 'mariadb', 'mongodb', 'redis']).describe('Database engine'),
      name: z.string().describe('Database name'),
      linkProjectId: z.string().optional().describe('If given, auto-injects DATABASE_URL into this project\'s env vars'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post('/api/databases', {
    engine: args.engine,
    name: args.name,
    linkProjectId: args.linkProjectId,
  })));

  tool('joytree_get_database', {
    title: 'Get database details',
    description: 'Get connection strings and status for a database by ID.',
    inputSchema: { databaseId: z.string() },
    annotations: { readOnlyHint: true },
  }, async (args, client) => textResult(await client.get(`/api/databases/${encodeURIComponent(args.databaseId)}`)));

  tool('joytree_database_lifecycle', {
    title: 'Start/stop/restart/delete a database',
    description: 'Change a database\'s running state. The "delete" action is permanent — confirm with the user before calling this with action:delete.',
    inputSchema: {
      databaseId: z.string(),
      action: z.enum(['start', 'stop', 'restart', 'delete']),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (args, client) => textResult(await client.post(`/api/databases/${encodeURIComponent(args.databaseId)}/${args.action}`)));

  // ── Data Migration ──────────────────────────────────────────────────
  // Moves data between databases regardless of engine, including from
  // external sources not hosted on JoyTree at all. The destination is
  // always one of the account's own provisioned databases; the source can
  // be another JoyTree database, or an external MongoDB/Firebase RTDB/
  // MySQL/PostgreSQL/MariaDB/Redis instance reached by connection string.
  tool('joytree_start_migration', {
    title: 'Start a data migration',
    description: 'Move all data from a source database into one of your JoyTree databases, regardless of engine (e.g. Mongo to MySQL, Firebase to Postgres, Redis to MariaDB — translation between data models is handled automatically). Runs in the background — use joytree_get_migration to poll progress with the returned migrationId.',
    inputSchema: {
      sourceKind: z.enum(['joytree', 'mongo', 'firebase', 'sql', 'redis']).describe(
        '"joytree" = another one of your own JoyTree databases (needs sourceDatabaseId). ' +
        '"mongo" = an external MongoDB/Atlas cluster (needs connectionString, which MUST include a database name — Atlas\'s default "Copy connection string" button omits it, which would otherwise silently read from Mongo\'s own default "test" database instead). ' +
        '"firebase" = a Firebase Realtime Database (needs firebaseDatabaseUrl). ' +
        '"sql" = an external MySQL, PostgreSQL, or MariaDB server (needs connectionString and sqlEngine). ' +
        '"redis" = an external Redis instance (needs connectionString).'
      ),
      sourceDatabaseId: z.string().optional().describe('Required when sourceKind is "joytree" — the ID of one of your own JoyTree databases to migrate FROM (from joytree_list_databases)'),
      connectionString: z.string().optional().describe('Required when sourceKind is "mongo", "sql", or "redis" — the external database\'s connection string. Used once for this migration only, never stored.'),
      sqlEngine: z.enum(['mysql', 'postgres', 'mariadb']).optional().describe('Required when sourceKind is "sql" — which engine connectionString connects to'),
      firebaseDatabaseUrl: z.string().optional().describe('Required when sourceKind is "firebase", e.g. https://your-project-default-rtdb.firebaseio.com'),
      firebaseAuthSecret: z.string().optional().describe('Optional Firebase legacy database secret — only needed if the RTDB\'s security rules require auth'),
      destinationDatabaseId: z.string().describe('The JoyTree database ID to migrate INTO (from joytree_list_databases) — always one of your own provisioned databases, never external'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => {
    let source;
    if (args.sourceKind === 'joytree') {
      if (!args.sourceDatabaseId) throw new Error('sourceDatabaseId is required when sourceKind is "joytree"');
      source = { kind: 'joytree', databaseId: args.sourceDatabaseId };
    } else if (args.sourceKind === 'mongo') {
      if (!args.connectionString) throw new Error('connectionString is required when sourceKind is "mongo"');
      source = { kind: 'mongo', connectionString: args.connectionString };
    } else if (args.sourceKind === 'firebase') {
      if (!args.firebaseDatabaseUrl) throw new Error('firebaseDatabaseUrl is required when sourceKind is "firebase"');
      source = { kind: 'firebase', databaseUrl: args.firebaseDatabaseUrl, authSecret: args.firebaseAuthSecret || null };
    } else if (args.sourceKind === 'sql') {
      if (!args.connectionString) throw new Error('connectionString is required when sourceKind is "sql"');
      if (!args.sqlEngine) throw new Error('sqlEngine is required when sourceKind is "sql"');
      source = { kind: 'sql', engine: args.sqlEngine, connectionString: args.connectionString };
    } else if (args.sourceKind === 'redis') {
      if (!args.connectionString) throw new Error('connectionString is required when sourceKind is "redis"');
      source = { kind: 'redis', connectionString: args.connectionString };
    }
    return textResult(await client.post('/api/migrations', {
      source,
      destination: { databaseId: args.destinationDatabaseId },
    }));
  });

  tool('joytree_list_migrations', {
    title: 'List migrations',
    description: 'List every migration you\'ve run (current in-progress ones plus history), most recent first.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async (_args, client) => textResult(await client.get('/api/migrations')));

  tool('joytree_get_migration', {
    title: 'Get migration status/logs',
    description: 'Get one migration\'s full status, result, and logs by ID (from joytree_start_migration or joytree_list_migrations). Poll this after starting a migration to see when it finishes.',
    inputSchema: { migrationId: z.string() },
    annotations: { readOnlyHint: true },
  }, async (args, client) => textResult(await client.get(`/api/migrations/${encodeURIComponent(args.migrationId)}`)));

  tool('joytree_delete_migration', {
    title: 'Delete a migration history entry',
    description: 'Permanently remove one migration from history by ID. Refuses if that migration is still running — wait for it to finish first.',
    inputSchema: { migrationId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (args, client) => textResult(await client.del(`/api/migrations/${encodeURIComponent(args.migrationId)}`)));

  tool('joytree_clear_migration_history', {
    title: 'Clear all migration history',
    description: 'Permanently delete ALL finished migration history entries at once. Migrations still in progress are left running and untouched. Irreversible — confirm with the user before calling this.',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: true },
  }, async (_args, client) => textResult(await client.del('/api/migrations')));

  // ── Realtime API Builder (prompt-to-API) ──────────────────────────
  tool('joytree_create_api_from_prompt', {
    title: 'Generate a REST API from a text prompt',
    description: 'Describe an API in plain English and get back a live REST endpoint, generated and hosted instantly — JoyTree\'s signature feature. Good for mock data, quick backends, or prototyping without writing a server by hand.',
    inputSchema: {
      prompt: z.string().describe('Plain-language description of the API, e.g. "A todo list API: create, list, complete, delete"'),
      aiVersion: z.enum(['v1', 'v2', 'v3', 'v4']).optional().describe('Generation engine (default v1 — free for everyone; v2 needs a paid plan; v3/v4 are currently admin-only)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post('/api/developer/flows/from-text', {
    prompt: args.prompt,
    aiVersion: args.aiVersion || 'v1',
  })));

  tool('joytree_list_generated_apis', {
    title: 'List generated APIs',
    description: 'List every API previously generated with joytree_create_api_from_prompt.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async (_args, client) => textResult(await client.get('/api/developer/apis')));

  tool('joytree_dockerize_api', {
    title: 'Dockerize a generated API',
    description: 'Turn a generated API flow into a persistent, standalone container with its own subdomain (rather than the lightweight shared runtime it starts on).',
    inputSchema: { flowId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post(`/api/developer/flows/${encodeURIComponent(args.flowId)}/dockerize`)));

  // ── GitHub helper ───────────────────────────────────────────────────
  tool('joytree_list_github_repos', {
    title: 'List connected GitHub repos',
    description: 'List repositories available through the user\'s connected GitHub account — useful to look up the right repoUrl before calling joytree_deploy_from_github.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async (_args, client) => textResult(await client.get('/api/github/repos')));
}

module.exports = { registerJoyTreeTools };
