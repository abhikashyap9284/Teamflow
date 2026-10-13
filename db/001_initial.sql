CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,email_verified INTEGER NOT NULL DEFAULT 0,auth_version INTEGER NOT NULL DEFAULT 1,created BIGINT NOT NULL);
-- statement-break
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires BIGINT NOT NULL,version INTEGER NOT NULL);
-- statement-break
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
-- statement-break
CREATE TABLE IF NOT EXISTS verification_tokens(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires BIGINT NOT NULL,purpose TEXT NOT NULL);
-- statement-break
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner TEXT NOT NULL,created BIGINT NOT NULL);
-- statement-break
CREATE TABLE IF NOT EXISTS memberships(id TEXT PRIMARY KEY,workspace TEXT NOT NULL REFERENCES workspaces(id),email TEXT NOT NULL,"user" TEXT,name TEXT NOT NULL,role TEXT NOT NULL,UNIQUE(workspace,email));
-- statement-break
CREATE INDEX IF NOT EXISTS member_user ON memberships("user");
-- statement-break
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,workspace TEXT NOT NULL REFERENCES workspaces(id),kind TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated BIGINT NOT NULL,author TEXT NOT NULL);
-- statement-break
CREATE INDEX IF NOT EXISTS record_scope ON records(workspace,kind);
-- statement-break
CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,workspace TEXT NOT NULL REFERENCES workspaces(id),actor TEXT NOT NULL,message TEXT NOT NULL,created BIGINT NOT NULL);
-- statement-break
CREATE INDEX IF NOT EXISTS activity_scope ON activity(workspace,created);
-- statement-break
CREATE TABLE IF NOT EXISTS checks(id TEXT PRIMARY KEY,workspace TEXT NOT NULL REFERENCES workspaces(id),monitor TEXT NOT NULL,status INTEGER NOT NULL,latency INTEGER NOT NULL,ok INTEGER NOT NULL,error TEXT,created BIGINT NOT NULL);
-- statement-break
CREATE INDEX IF NOT EXISTS check_scope ON checks(workspace,created);
-- statement-break
CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,workspace TEXT NOT NULL REFERENCES workspaces(id),created BIGINT NOT NULL);
-- statement-break
CREATE TABLE IF NOT EXISTS rate_limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires BIGINT NOT NULL);
-- statement-break
CREATE TABLE IF NOT EXISTS attachment_data(key TEXT PRIMARY KEY,payload TEXT NOT NULL,size INTEGER NOT NULL,updated BIGINT NOT NULL);
