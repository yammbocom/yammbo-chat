-- 0005_visitor_seen.sql
-- When the visitor's OPEN chat last showed a team message of this conversation: epoch ms
-- of the newest team message (role 'agent') that GET /api/messages?open=1 handed to a widget
-- with the chat view open and visible. NULL = never. It is written only when that value grows
-- (see listLiveMessages in src/inbox.ts) and goes away with the conversation (90-day purge).
-- postReply() in src/panel-inbox.ts reads it: 15 s after a team reply, if visitor_seen_at is
-- older than the reply, the visitor gets the email copy of the replies they have not seen.
-- No index: it is only read by conversation id.
ALTER TABLE conversations ADD COLUMN visitor_seen_at INTEGER;
