-- Associate live agent activity and final replies with the user message currently being processed. The
-- parties row is already in the Realtime publication, so every member receives the active-message change.
alter table public.parties
  add column active_agent_message_id uuid;

alter table public.chat_messages
  add column reply_to_message_id uuid references public.chat_messages(id) on delete set null;

create index chat_messages_reply_to_message_id_idx
  on public.chat_messages (reply_to_message_id);
