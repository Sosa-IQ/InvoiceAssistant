import json
import logging
import re
from datetime import date

from openai import OpenAI

from app.config import settings
from app.models.schemas import InvoiceData, InvoiceSchema

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schema example passed verbatim to the model so it knows the exact shape
# ---------------------------------------------------------------------------
_SCHEMA_EXAMPLE = {
    "invoice": {
        "invoice_number": "Invoice-#1",
        "issue_date": "2025-11-01",
        "status": "draft",
        "from": {
            "name": "",
            "address": "",
            "email": "",
            "phone": "",
            "logo_path": None,
        },
        "to": {
            "client_id": None,
            "name": "",
            "address": "",
            "email": "",
            "phone": "",
        },
        "line_items": [
            {
                "description": "",
                "quantity": 1,
                "unit": "item",
                "unit_price": 0.0,
                "subtotal": 0.0,
            }
        ],
        "totals": {
            "subtotal": 0.0,
            "grand_total": 0.0,
        },
        "notes": None,
    }
}


def _build_system_prompt(
    business_profile: dict,
    rag_context: str,
    next_invoice_number: str,
) -> str:
    today = date.today().isoformat()
    schema_json = json.dumps(_SCHEMA_EXAMPLE, indent=2)
    profile_json = json.dumps(business_profile, indent=2)
    rag_block = rag_context if rag_context else "(no historical invoices available)"

    return f"""You are an invoice generation assistant. Return ONLY valid JSON matching the schema below.
No explanations, no markdown fences, no trailing commas.

Rules:
- Calculate each line item subtotal: quantity * unit_price
- Use today's date ({today}) as issue_date if the user does not specify one
- Use null (never "") for unknown optional fields
- Set invoice_number to "{next_invoice_number}" exactly — do not change it
- Populate the "from" block from the BUSINESS PROFILE below

SCHEMA:
{schema_json}

BUSINESS PROFILE:
{profile_json}

HISTORICAL INVOICE CONTEXT:
{rag_block}"""


def _extract_json(raw: str) -> dict:
    """Strip optional markdown code fences and parse JSON."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned.strip())
    return json.loads(cleaned)


class OpenAIService:
    MAX_RETRIES = 2

    def __init__(self) -> None:
        self.client = OpenAI(api_key=settings.openai_api_key)

    def generate_invoice(
        self,
        prompt: str,
        business_profile: dict,
        rag_context: str,
        next_invoice_number: str,
    ) -> InvoiceData:
        """
        Call gpt-4o-mini and return a validated InvoiceData.

        Retries up to MAX_RETRIES times on JSON/validation failure.
        Raises ValueError (caught by the route and returned as HTTP 422)
        if all attempts fail.
        """
        system_prompt = _build_system_prompt(
            business_profile=business_profile,
            rag_context=rag_context,
            next_invoice_number=next_invoice_number,
        )

        last_error: Exception | None = None
        last_raw: str = ""

        for attempt in range(self.MAX_RETRIES + 1):
            if attempt > 0:
                logger.warning("Retrying OpenAI call (attempt %d/%d)...", attempt + 1, self.MAX_RETRIES + 1)

            response = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=2048,
            )

            last_raw = response.choices[0].message.content or ""
            logger.debug("OpenAI raw response (attempt %d): %.500s", attempt + 1, last_raw)

            try:
                data = _extract_json(last_raw)
                schema = InvoiceSchema.model_validate(data)
                logger.info("OpenAI returned valid invoice JSON on attempt %d.", attempt + 1)
                return schema.invoice
            except Exception as exc:
                logger.warning("OpenAI response parse failed (attempt %d): %s", attempt + 1, exc)
                last_error = exc

        raise ValueError(
            f"OpenAI returned invalid JSON after {self.MAX_RETRIES + 1} attempts. "
            f"Last error: {last_error}. Raw: {last_raw[:500]}"
        )
