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

// Extra deploy options supported by the JoyTree server (Background Workers,
// Dockerfile deploys, runtime/version pins, ...). Shared by every tool that
// starts a deploy so they all accept the same set. Only fields the caller
// actually set are forwarded, so server-side defaults and auto-detection
// still apply to everything left out.
const deployOptionsShape = {
  runtime: z.string().optional().describe('Explicit runtime, e.g. node, python, django, go, php, laravel, ruby, java, dotnet, rust, elixir, bun, deno. Leave blank to auto-detect from the repo.'),
  workingDir: z.string().optional().describe('Sub-directory to build and run from (monorepos), e.g. apps/api'),
  isWorker: z.boolean().optional().describe('Deploy as a Background Worker: a long-running process with no public HTTP port (queue consumers, bots, schedulers). Requires startCmd.'),
  isDockerfileDeploy: z.boolean().optional().describe('Build from a Dockerfile in the repo instead of auto-detecting the framework. Implied when dockerfilePath is set.'),
  dockerfilePath: z.string().optional().describe('Repo-relative path to the Dockerfile (default: Dockerfile), e.g. worker/Dockerfile'),
  dockerCommand: z.string().optional().describe('Override the Dockerfile CMD when using a Dockerfile deploy'),
  exposedPort: z.number().int().min(1).max(65535).optional().describe('Port the app listens on inside the container (default 3000). Mainly for Dockerfile deploys.'),
  preDeployCommand: z.string().optional().describe('Command run once after a successful build and before the new version goes live, e.g. a database migration'),
  pythonVer: z.string().optional().describe('Python version pin, e.g. "3.12"'),
  goVer: z.string().optional().describe('Go version pin, e.g. "1.22"'),
  phpVer: z.string().optional().describe('PHP version pin, e.g. "8.3"'),
  rubyVer: z.string().optional().describe('Ruby version pin, e.g. "3.3"'),
  javaVer: z.string().optional().describe('Java version pin, e.g. "21"'),
  dotnetVer: z.string().optional().describe('.NET version pin, e.g. "8.0"'),
  envVars: z.record(z.string()).optional().describe('Environment variables to set on the project at deploy time, e.g. { "DATABASE_URL": "postgres://..." }'),
  includedPaths: z.array(z.string()).optional().describe('Only deploy when changes touch these paths (monorepo build filter)'),
  ignoredPaths: z.array(z.string()).optional().describe('Skip deploys for changes that only touch these paths'),
};

function pickDeployOptions(args) {
  const out = {};
  for (const key of Object.keys(deployOptionsShape)) {
    if (args[key] !== undefined) out[key] = args[key];
  }
  return out;
}

function qs(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

const enc = encodeURIComponent;

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
    description: 'Deploy a project straight from a GitHub repository. This is the main "ship it" tool — call this once code is pushed and ready to go live. Framework/build settings are auto-detected if omitted. If there is no repo to push to (e.g. a project generated locally with no git remote), use joytree_deploy_from_zip instead. For a Background Worker set isWorker with a startCmd; for a Dockerfile build set isDockerfileDeploy (or dockerfilePath) and exposedPort; for a multi-service stack described by a joytree.joy file use joytree_blueprint_plan then joytree_blueprint_deploy instead.',
    inputSchema: {
      name: z.string().describe('Project name — also becomes the <name>.joytree.site subdomain unless a custom subdomain is given'),
      repoUrl: z.string().describe('GitHub repository URL, e.g. https://github.com/you/my-app'),
      branch: z.string().optional().describe('Branch to deploy (default: main)'),
      subdomain: z.string().optional().describe('Custom subdomain, if different from the project name'),
      buildCmd: z.string().optional().describe('Override the auto-detected build command'),
      startCmd: z.string().optional().describe('Override the auto-detected start command (server apps only)'),
      outputDir: z.string().optional().describe('Override the auto-detected output directory'),
      siteType: z.enum(['static', 'server']).optional().describe('Force static vs. server app instead of auto-detecting'),
      installCmd: z.string().optional().describe('Override the auto-detected install command'),
      nodeVer: z.string().optional().describe('Node.js version, e.g. "20"'),
      ...deployOptionsShape,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post('/api/v1/deploy', {
    ...pickDeployOptions(args),
    installCmd: args.installCmd,
    nodeVer: args.nodeVer,
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
    description: 'Deploy a project directly from its files, either as a base64-encoded zip archive or a URL to one — for cases where there is no GitHub repo to point at, e.g. a project you (the AI) just generated locally. Build/start commands and runtime are auto-detected from the archive contents if omitted, the same way joytree_deploy_from_github auto-detects from a cloned repo. Prefer zipUrl when the archive is already reachable at a URL (e.g. a GitHub archive link like https://github.com/<owner>/<repo>/archive/refs/heads/<branch>.zip, or a release asset) — the server fetches it directly, which is more reliable than inlining a large base64 string. Use zipBase64 only for genuinely small archives (a handful of files, roughly under a few MB) that comfortably fit as one base64 string in a single tool call. For anything larger with no URL available, use joytree_zip_upload_start / joytree_zip_upload_chunk / joytree_zip_upload_finish instead — they send the same archive as many small chunks rather than one large call. Archives over ~190MB pre-encoding (260MB after base64 inflation, or as fetched via zipUrl) will be rejected — for larger projects, push to GitHub and use joytree_deploy_from_github instead.',
    inputSchema: {
      name: z.string().describe('Project name — also becomes the <n>.joytree.site subdomain unless a custom subdomain is given'),
      zipUrl: z.string().optional().describe('URL to a downloadable .zip archive (must be https://). Preferred over zipBase64 when available — the server fetches it directly.'),
      zipBase64: z.string().optional().describe('Base64-encoded bytes of a .zip archive containing the project files at its root (or a single top-level project folder). Only needed if zipUrl is not available.'),
      subdomain: z.string().optional().describe('Custom subdomain, if different from the project name'),
      buildCmd: z.string().optional().describe('Override the auto-detected build command'),
      startCmd: z.string().optional().describe('Override the auto-detected start command (server apps only)'),
      installCmd: z.string().optional().describe('Override the auto-detected install command'),
      outputDir: z.string().optional().describe('Override the auto-detected output directory (static sites only)'),
      siteType: z.enum(['static', 'server']).optional().describe('Force static vs. server app instead of auto-detecting'),
      nodeVer: z.string().optional().describe('Node.js version, e.g. "20" (default: 20, or whatever package.json engines specifies)'),
      ...deployOptionsShape,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post('/api/v1/deploy-from-zip', {
    ...pickDeployOptions(args),
    name: args.name,
    subdomain: args.subdomain || args.name,
    zipUrl: args.zipUrl,
    zipBase64: args.zipBase64,
    buildCmd: args.buildCmd,
    startCmd: args.startCmd,
    installCmd: args.installCmd,
    outputDir: args.outputDir,
    siteType: args.siteType,
    nodeVer: args.nodeVer,
  })));

  // ── Chunked zip deploy (bridge for large archives) ───────────────────
  // joytree_deploy_from_zip above requires the ENTIRE archive as one
  // base64 string in a single tool call -- fine for small projects, but
  // for anything bigger, generating that string is bounded by the calling
  // AI's own per-call output budget, not by anything this server enforces
  // (deploy-from-zip itself accepts up to 260MB). These three tools break
  // the same underlying upload into many small calls instead: start a
  // session, send the archive as a sequence of modest base64 chunks (each
  // its own small, safe tool call), then finish -- at which point the
  // server has already reassembled the full archive server-side and hands
  // off to the exact same deploy pipeline deploy-from-zip already uses.
  // The calling AI never makes a network request itself; every step is an
  // ordinary MCP tool call.
  tool('joytree_zip_upload_start', {
    title: 'Start a chunked zip upload',
    description: 'Step 1 of 3 for deploying a large project with no GitHub repo. Opens an upload session on the server for an archive you\'ll send in pieces via joytree_zip_upload_chunk. Use this instead of joytree_deploy_from_zip whenever the archive is too large to comfortably send as one base64 string in a single tool call (roughly a few MB of source or more) -- for small projects, joytree_deploy_from_zip in one call is simpler and preferred. The session expires after 20 minutes of inactivity. Strongly recommended: pass sha256, the SHA-256 hex digest of the complete RAW zip file (before any base64 encoding) -- joytree_zip_upload_finish verifies the reassembled archive against it byte-for-byte and refuses to deploy on a mismatch, catching any corruption from chunking or transit instead of silently deploying a broken build.',
    inputSchema: {
      totalBytes: z.number().int().positive().describe('Total size of the RAW (pre-base64) zip archive, in bytes. Used to validate the upload and reject anything over the 260MB limit up front rather than after uploading.'),
      sha256: z.string().optional().describe('SHA-256 hex digest (64 lowercase hex characters) of the complete RAW zip file, computed BEFORE base64 encoding. Strongly recommended -- verified on joytree_zip_upload_finish.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post('/api/v1/zip-uploads', {
    totalBytes: args.totalBytes,
    sha256: args.sha256,
  })));

  tool('joytree_zip_upload_chunk', {
    title: 'Send one chunk of a zip upload',
    description: 'Step 2 of 3 (call repeatedly). Sends one piece of the archive started with joytree_zip_upload_start. IMPORTANT — how to chunk correctly: slice the RAW zip file\'s bytes first (e.g. bytes 0-150000, then 150000-300000, ...), THEN base64-encode each raw slice independently, so every chunkBase64 is a complete, valid, standalone base64 string on its own. Do NOT base64-encode the whole archive first and then cut the resulting TEXT into pieces — a mid-string slice of base64 text is not independently decodable and will corrupt the archive (this is caught on finish and rejected, but avoid it: chunk the source bytes, not the encoded text). Keep each chunk to roughly 150-250KB of base64 text (~110-190KB of raw bytes) so every call stays small. Call in order, chunkIndex 0, 1, 2, ... with no gaps or repeats, until the whole archive has been sent.',
    inputSchema: {
      uploadId: z.string().describe('The uploadId returned by joytree_zip_upload_start'),
      chunkIndex: z.number().int().nonnegative().describe('0-based index of this chunk, in order, no gaps or repeats'),
      chunkBase64: z.string().describe('Base64 encoding of a contiguous slice of the RAW archive bytes (encode the raw slice itself, not a piece of an already-fully-encoded string)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post(`/api/v1/zip-uploads/${encodeURIComponent(args.uploadId)}/chunk`, {
    chunkIndex: args.chunkIndex,
    chunkBase64: args.chunkBase64,
  })));

  tool('joytree_zip_upload_finish', {
    title: 'Finish a chunked zip upload and deploy',
    description: 'Step 3 of 3. Call once every chunk from joytree_zip_upload_chunk has been sent and their reported received-bytes total matches the totalBytes given to joytree_zip_upload_start. The server verifies the reassembled archive (a zip-signature check always, plus a full sha256 comparison if one was given to joytree_zip_upload_start) before doing anything else — if verification fails, nothing is deployed and the error explains why; start a fresh upload session rather than retrying finish. On success, assembles the uploaded chunks into the final archive server-side and deploys it -- same auto-detection and build pipeline as joytree_deploy_from_zip.',
    inputSchema: {
      uploadId: z.string().describe('The uploadId from joytree_zip_upload_start'),
      name: z.string().describe('Project name — also becomes the <n>.joytree.site subdomain unless a custom subdomain is given'),
      subdomain: z.string().optional().describe('Custom subdomain, if different from the project name'),
      buildCmd: z.string().optional().describe('Override the auto-detected build command'),
      startCmd: z.string().optional().describe('Override the auto-detected start command (server apps only)'),
      installCmd: z.string().optional().describe('Override the auto-detected install command'),
      outputDir: z.string().optional().describe('Override the auto-detected output directory (static sites only)'),
      siteType: z.enum(['static', 'server']).optional().describe('Force static vs. server app instead of auto-detecting'),
      nodeVer: z.string().optional().describe('Node.js version, e.g. "20" (default: 20, or whatever package.json engines specifies)'),
      ...deployOptionsShape,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => textResult(await client.post(`/api/v1/zip-uploads/${encodeURIComponent(args.uploadId)}/finish`, {
    ...pickDeployOptions(args),
    name: args.name,
    subdomain: args.subdomain || args.name,
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
  //
  // This same source shape (sourceKind + the fields relevant to it) is
  // also used by joytree_compare_databases below, for BOTH sides of a
  // comparison -- buildMigrationSourceFromArgs() is shared between them so
  // the two tools can't drift apart on how a source gets resolved.
  const sourceKindDescription =
    '"joytree" = another one of your own JoyTree databases (needs sourceDatabaseId). ' +
    '"mongo" = an external MongoDB/Atlas cluster (needs connectionString, which MUST include a database name — Atlas\'s default "Copy connection string" button omits it, which would otherwise silently read from Mongo\'s own default "test" database instead). ' +
    '"firebase" = a Firebase Realtime Database (needs firebaseDatabaseUrl). ' +
    '"sql" = an external MySQL, PostgreSQL, or MariaDB server (needs connectionString and sqlEngine) — this is also how to reach Supabase, since Supabase\'s database is standard Postgres under the hood: use sqlEngine "postgres" with the connection string from Supabase\'s Project Settings → Database (either the pooler string on port 6543 or the direct one on port 5432 both work; SSL is handled automatically). ' +
    '"redis" = an external Redis instance (needs connectionString).';

  function buildMigrationSourceFromArgs(args) {
    if (args.sourceKind === 'joytree') {
      if (!args.sourceDatabaseId) throw new Error('sourceDatabaseId is required when sourceKind is "joytree"');
      return { kind: 'joytree', databaseId: args.sourceDatabaseId };
    } else if (args.sourceKind === 'mongo') {
      if (!args.connectionString) throw new Error('connectionString is required when sourceKind is "mongo"');
      return { kind: 'mongo', connectionString: args.connectionString };
    } else if (args.sourceKind === 'firebase') {
      if (!args.firebaseDatabaseUrl) throw new Error('firebaseDatabaseUrl is required when sourceKind is "firebase"');
      return { kind: 'firebase', databaseUrl: args.firebaseDatabaseUrl, authSecret: args.firebaseAuthSecret || null };
    } else if (args.sourceKind === 'sql') {
      if (!args.connectionString) throw new Error('connectionString is required when sourceKind is "sql"');
      if (!args.sqlEngine) throw new Error('sqlEngine is required when sourceKind is "sql"');
      return { kind: 'sql', engine: args.sqlEngine, connectionString: args.connectionString };
    } else if (args.sourceKind === 'redis') {
      if (!args.connectionString) throw new Error('connectionString is required when sourceKind is "redis"');
      return { kind: 'redis', connectionString: args.connectionString };
    }
    throw new Error(`Unknown sourceKind: ${args.sourceKind}`);
  }

  tool('joytree_start_migration', {
    title: 'Start a data migration',
    description: 'Move all data from a source database into one of your JoyTree databases, regardless of engine (e.g. Mongo to MySQL, Firebase to Postgres, Redis to MariaDB — translation between data models is handled automatically). Runs in the background — use joytree_get_migration to poll progress with the returned migrationId.',
    inputSchema: {
      sourceKind: z.enum(['joytree', 'mongo', 'firebase', 'sql', 'redis']).describe(sourceKindDescription),
      sourceDatabaseId: z.string().optional().describe('Required when sourceKind is "joytree" — the ID of one of your own JoyTree databases to migrate FROM (from joytree_list_databases)'),
      connectionString: z.string().optional().describe('Required when sourceKind is "mongo", "sql", or "redis" — the external database\'s connection string. Used once for this migration only, never stored.'),
      sqlEngine: z.enum(['mysql', 'postgres', 'mariadb']).optional().describe('Required when sourceKind is "sql" — which engine connectionString connects to'),
      firebaseDatabaseUrl: z.string().optional().describe('Required when sourceKind is "firebase", e.g. https://your-project-default-rtdb.firebaseio.com'),
      firebaseAuthSecret: z.string().optional().describe('Optional Firebase legacy database secret — only needed if the RTDB\'s security rules require auth'),
      destinationDatabaseId: z.string().describe('The JoyTree database ID to migrate INTO (from joytree_list_databases) — always one of your own provisioned databases, never external'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (args, client) => {
    const source = buildMigrationSourceFromArgs(args);
    return textResult(await client.post('/api/migrations', {
      source,
      destination: { databaseId: args.destinationDatabaseId },
    }));
  });

  // ── Compare Databases ─────────────────────────────────────────────────
  // A genuinely novel capability: diffs two databases collection-by-
  // collection and row-by-row, reporting exactly what's added, removed,
  // and changed -- even across completely different engines. Both sides
  // are described with the exact same source shape joytree_start_migration
  // uses (see buildMigrationSourceFromArgs above), just nested under
  // databaseA/databaseB instead of a single top-level source.
  const compareSourceSchema = z.object({
    sourceKind: z.enum(['joytree', 'mongo', 'firebase', 'sql', 'redis']).describe(sourceKindDescription),
    sourceDatabaseId: z.string().optional().describe('Required when sourceKind is "joytree"'),
    connectionString: z.string().optional().describe('Required when sourceKind is "mongo", "sql", or "redis". Used once for this comparison only, never stored.'),
    sqlEngine: z.enum(['mysql', 'postgres', 'mariadb']).optional().describe('Required when sourceKind is "sql"'),
    firebaseDatabaseUrl: z.string().optional().describe('Required when sourceKind is "firebase"'),
    firebaseAuthSecret: z.string().optional().describe('Optional Firebase legacy database secret'),
  });

  tool('joytree_compare_databases', {
    title: 'Compare two databases',
    description: 'Compare two databases and see exactly what differs -- added, removed, and changed rows/documents, with field-level before/after values for anything changed. Works even when the two sides are completely different engines (e.g. a MongoDB collection vs. a Postgres table vs. a Redis keyspace), since everything is normalized to the same shape before comparing. Rows are matched by id where one exists, or by content otherwise, so reordered data still compares correctly.',
    inputSchema: {
      databaseA: compareSourceSchema.describe('The first database to compare'),
      databaseB: compareSourceSchema.describe('The second database to compare'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async (args, client) => {
    const sourceA = buildMigrationSourceFromArgs(args.databaseA);
    const sourceB = buildMigrationSourceFromArgs(args.databaseB);
    return textResult(await client.post('/api/databases/diff', { sourceA, sourceB }));
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
