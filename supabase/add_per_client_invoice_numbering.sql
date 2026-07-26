alter table public.clients
  add column if not exists client_code text;

alter table public.invoice_records
  add column if not exists client_id bigint references public.clients(id) on delete set null;

alter table public.invoice_records
  add column if not exists client_invoice_sequence integer;

create unique index if not exists uq_clients_user_id_client_code
  on public.clients(user_id, client_code);

create unique index if not exists uq_invoice_records_user_client_sequence
  on public.invoice_records(user_id, client_id, client_invoice_sequence);

create index if not exists ix_clients_client_code on public.clients(client_code);
create index if not exists ix_invoice_records_client_id on public.invoice_records(client_id);
