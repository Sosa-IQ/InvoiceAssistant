# InvoiceAssistant TODO

## 1. Clients Page Address Collapse

- Add an expand/collapse control for each client's address list on the Clients page.
- Show a compact summary when collapsed, such as `3 addresses`, plus maybe the primary/default address if one exists later.
- Keep address actions available in a clean way:
  - `Add address` should remain visible even when the list is collapsed.
  - Edit/delete controls should appear only when expanded.
- Consider default behavior:
  - Collapse clients with more than 1 address by default.
  - Keep clients with 0 or 1 address simple and readable.
- Add visual affordance with a chevron icon and accessible `aria-expanded` state.

## 2. Catalog Items as Invoice Generation Context

- Include saved catalog items in the AI invoice-generation prompt so the agent can reference known services/products, units, and prices.
- Backend:
  - Load catalog items during `/api/invoices/generate`.
  - Pass catalog data into the OpenAI prompt alongside business profile, client data, and historical invoice context.
  - Instruct the model to prefer saved catalog items when the user's prompt matches them.
  - Decide whether catalog matches should be exact, fuzzy, or model-driven.
- Frontend:
  - Make generated invoice line items easy to compare against stored catalog entries.
  - Consider showing a subtle indicator when a line item came from or matched a catalog item.
- Tests:
  - Verify that catalog items are included in generation context.
  - Verify that generated prices/units can come from catalog data.

## 3. Recommended Catalog Items From Stored Invoices

- Add a `Get recommendations` button to the Catalog page.
- Backend:
  - Create an endpoint like `POST /api/catalog/recommendations`.
  - Analyze stored/generated invoices and historical uploaded invoices to find repeated line items, services, units, and prices.
  - Exclude items already present in the catalog.
  - Return structured recommendations with description, unit, unit price, notes, confidence/reason, and supporting invoice examples if available.
- Frontend:
  - Show recommendations in a review dialog or panel.
  - Allow saving recommendations individually.
  - Add a `Save all` action.
  - Let the user dismiss or ignore recommendations.
- Product details to decide:
  - Should recommendations use only exported invoices with structured JSON, or also parsed uploaded PDFs?
  - Should similar descriptions be merged, such as `Labor`, `General labor`, and `Hourly labor`?
  - Should price suggestions use average, most recent, most common, or a user-selectable value?

## 4. Sign Up, Log In, and User Data Privacy

- Add user accounts with sign up, log in, log out, and session/token handling.
- Add a `users` table.
- Add `user_id` ownership to private tables:
  - `business_settings`
  - `clients`
  - `client_addresses`
  - `catalog_items`
  - `invoice_records`
- Update every API query and mutation to filter by the authenticated user's `user_id`.
- Update invoice numbering to be per-user instead of global.
- Change invoice numbering so it is tracked per client, within each user's account, instead of using one universal sequence shared by every client.
- Backend numbering rules:
  - When creating the next invoice for a client, count only that client's prior invoices for the current user.
  - Example: if Client A has 5 invoices, the next invoice for Client A should be `6`.
  - Example: if Client B has 1 invoice, the next invoice for Client B should be `2`, not `6`.
  - Decide whether invoice drafts without a selected client should defer numbering until client selection, or use a temporary placeholder until a client is chosen.
- Data/model decision:
  - Decide whether to store both a display `invoice_number` and a separate numeric `client_invoice_sequence`.
  - Add uniqueness rules that make sense inside a user account, likely something like unique per `user_id + client_id + client_invoice_sequence`.
- Add authorization checks so one user cannot fetch, update, delete, export, preview, email, or index another user's records.
- Frontend:
  - Add auth pages/routes.
  - Hide the main app behind authentication.
  - Add current-user state and logout control.
- Migration/data decision:
  - Existing data will need to be assigned to a first/default user or migrated manually.

### RAG Privacy Clarification

Yes, per-user RAG is possible and should be required before multi-user launch.

The current vector store uses a shared `invoices` collection and does not filter retrieval by user. To make RAG private per user, each embedded invoice chunk needs user ownership metadata, and every vector query must be filtered to the authenticated user.

Recommended approach:

- Add `user_id` metadata to every vector chunk when uploading or indexing invoices.
- Store `user_id` on the related `invoice_records` row.
- Change vector queries to include a metadata filter like `where={"user_id": current_user.id}`.
- Change vector deletes to delete by both `doc_id` and `user_id` when supported, or otherwise verify ownership before deletion.
- Consider either:
  - One shared Chroma collection with strict `user_id` metadata filters, or
  - Separate per-user collections/namespaces.

The shared collection approach is simpler, but it must be implemented carefully and covered by tests. The key rule is: no RAG query should ever run without a user filter once auth exists.

### Invoice Number Naming Ideas

Possible naming formats once numbering becomes per-client:

- `ClientName-6`
  - Human-friendly, but can get awkward when client names change or contain punctuation.
- `CLIENTCODE-006`
  - Clean and readable if each client has a short stable code.
- `Smith-0006`
  - Similar to above, using a slug/short label from the client name.
- `INV-CLIENTCODE-006`
  - Most explicit and probably the safest default if you want invoices to stay easy to sort and identify.
- Keep a plain per-client number in the data model, but render a display value like `Acme / Invoice 6`
  - Nice for UI clarity, while keeping the stored sequence logic simple.

Selected naming convention:

- Use `INV-CLIENTCODE_##`
- Example: `INV-ACME_06`
- Example: `INV-SMITH_02`

Recommended implementation details:

- Store a numeric per-client sequence in the database.
- Add a stable `client_code` or slug field for each client.
- Render the final invoice number as `INV-{CLIENTCODE}_{sequence}`.
- Decide whether the sequence should always be zero-padded to 2 digits, or expand to 3+ digits automatically after `99`.

That approach keeps the numbering logic simple, avoids collisions, and gives a consistent visible format.

## 5. Email Invoices From the App

- Store and validate client emails.
  - The `clients` table already has an `email` field, but invoice sending should confirm it is present before sending.
  - Consider supporting multiple recipient emails later if needed.
- Add email service integration.
  - Options include SendGrid, Postmark, Resend, Mailgun, Amazon SES, or SMTP.
  - Store provider API keys in environment variables, not in the database.
- Backend:
  - Create an endpoint like `POST /api/invoices/{record_id}/send`.
  - Ensure the invoice belongs to the authenticated user.
  - Generate or load the final PDF.
  - Attach the PDF to the email.
  - Send to the client's email.
  - CC the logged-in user's email.
  - Store send status, sent timestamp, recipient, cc, provider message id, and any error.
- Frontend:
  - Add a preview step before sending.
  - Let the user save/download the PDF before sending.
  - Show recipient, CC, subject, and message body before send.
  - Confirm successful send and preserve send history on the invoice.
- Data model:
  - Add fields to `invoice_records`, or create a separate `invoice_emails` table for send history.
- Safety:
  - Prevent sending draft/invalid invoices.
  - Warn if the client has no email.
  - Consider a resend flow.

## Suggested Implementation Order

1. Add client address collapse UI.
2. Add catalog items to invoice-generation context.
3. Add catalog recommendation endpoint and Catalog page review UI.
4. Add authentication and per-user database ownership.
5. Change invoice numbering to be per-client within each user account, and finalize the display naming convention.
6. Update RAG indexing/querying/deleting to be strictly per-user.
7. Add invoice PDF preview/save improvements if needed.
8. Add email sending service and send history.
9. Add tests for auth isolation, per-client invoice numbering, RAG isolation, catalog recommendations, and email permissions.
