import { unknownPlaceholders } from "./emailTemplates"

it("flags brace groups that aren't a known placeholder, once each", () => {
  expect(unknownPlaceholders("Invoice {invoice_number} for {foo} and {foo}")).toEqual(["{foo}"])
  expect(unknownPlaceholders("Hi { client_name }, total {total}")).toEqual(["{ client_name }"])
  expect(unknownPlaceholders("All good: {client_name} {currency}")).toEqual([])
  expect(unknownPlaceholders(null)).toEqual([])
})
