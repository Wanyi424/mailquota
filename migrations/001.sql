CREATE TABLE customer_usage (
 customer_id TEXT PRIMARY KEY, used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count>=0),
 reserved_count INTEGER NOT NULL DEFAULT 0 CHECK(reserved_count>=0), updated_at INTEGER NOT NULL
);
CREATE TABLE send_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT NOT NULL REFERENCES customer_usage(customer_id),
 request_id TEXT NOT NULL, email TEXT NOT NULL, client_ip TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','failed','unknown')),
 provider_message_id TEXT, error_code TEXT, error_detail TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 resolved_at INTEGER, resolved_by TEXT, resolution_note TEXT, UNIQUE(customer_id,request_id)
);
CREATE INDEX sends_customer_time ON send_requests(customer_id,created_at DESC,id DESC);
CREATE INDEX sends_status_time ON send_requests(status,created_at DESC,id DESC);
CREATE TABLE verification_codes (
 customer_id TEXT NOT NULL REFERENCES customer_usage(customer_id), email TEXT NOT NULL,
 code TEXT NOT NULL CHECK(length(code)=6), send_request_id INTEGER NOT NULL REFERENCES send_requests(id),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), expires_at INTEGER NOT NULL,
 consumed_at INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY(customer_id,email)
);
CREATE INDEX codes_expiry ON verification_codes(expires_at);
CREATE TABLE rate_limits (
 customer_id TEXT NOT NULL REFERENCES customer_usage(customer_id), limit_type TEXT NOT NULL CHECK(limit_type IN ('email_cooldown','email_hour','ip_hour')),
 target TEXT NOT NULL, count INTEGER NOT NULL CHECK(count>=0), expires_at INTEGER NOT NULL,
 PRIMARY KEY(customer_id,limit_type,target)
);
CREATE INDEX limits_expiry ON rate_limits(expires_at);
PRAGMA user_version=1;
