import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

export const runtime = 'edge';

// Server-side safety net: truncate to first 5 pages (if client-side truncation fails)
async function truncatePDFToFivePagesBuffer(inputBytes: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(inputBytes);
  const pageCount = pdfDoc.getPageCount();
  if (pageCount <= 5) return inputBytes;
  const newPdf = await PDFDocument.create();
  const indices = [0,1,2,3,4];
  const copy = await newPdf.copyPages(pdfDoc, indices.filter(i => i < pageCount));
  copy.forEach(p => newPdf.addPage(p));
  return await newPdf.save();
}

// Zod schema matching the expected JSON shape
const AcordSchema = z.object({
  certificate_information: z.object({
    certificate_holder: z.string(),
    certificate_number: z.string(),
    revision_number: z.string().nullable(),
    issue_date: z.string(),
  }),
  insurers: z
    .array(
      z.object({
        insurer_letter: z.string(),
        insurer_name: z.string(),
        naic_code: z.string().nullable(),
      })
    )
    .default([]),
  policies: z
    .array(
      z.object({
        policy_information: z.object({
          policy_type: z.string(),
          policy_number: z.string(),
          effective_date: z.string(),
          expiry_date: z.string(),
        }),
        insurer_letter: z.string(),
        coverages: z
          .array(
            z.object({
              limit_type: z.string(),
              limit_value: z.number(),
            })
          )
          .default([]),
      })
    )
    .default([]),
  producer_information: z.object({
    primary_details: z.object({
      full_name: z.string().nullable(),
      email_address: z.string().nullable(),
      doing_business_as: z.string().nullable(),
    }),
    contact_information: z.object({
      phone_number: z.string(),
      fax_number: z.string().nullable(),
      license_number: z.string().nullable(),
    }),
    address_details: z.object({
      address_line_1: z.string(),
      address_line_2: z.string().nullable(),
      address_line_3: z.string().nullable(),
      city: z.string(),
      state: z.string(),
      zip_code: z.string(),
      country: z.literal('USA'),
    }),
  }),
});

type AcordResponse = z.infer<typeof AcordSchema> | null;

// Gemini API call function via Next.js AI SDK
async function callGeminiUsingAiSdk(pdfBytes: Uint8Array): Promise<AcordResponse> {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }

  const prompt = `
CRITICAL VALIDATION:
Your FIRST task is to determine if the provided document is a genuine ACORD 25 Certificate of Liability Insurance (COI) form.
- You MUST be at least 95% certain it is an ACORD 25 COI.
- If you are less than 95% certain, or if the document is not an ACORD 25 COI, you MUST immediately return only the literal JSON value: null
- Do NOT attempt to extract or hallucinate any data if you are not sure.
- Do NOT return any other text, explanation, or JSON structure. Just return null.

How to identify an ACORD 25 COI:
- Look for key terms such as "Certificate of Liability Insurance", "ACORD 25", "INSURER(S) AFFORDING COVERAGE", "CERTIFICATE HOLDER", "PRODUCER", "POLICY NUMBER", "EFFECTIVE DATE", "LIABILITY", etc.
- If these terms are missing or the document appears to be a different type of form, return null.

If the document is a valid ACORD 25 COI, proceed with extraction as instructed below.

### 📌 INSURER INFORMATION EXTRACTION

**FIRST**: Extract all insurer information from the **"INSURER(S) AFFORDING COVERAGE"** section at the top right of the form:
- For each insurer (A, B, C, D, E, F, etc.), extract:
  - \`insurer_letter\`: The letter (A, B, C, etc.)
  - \`insurer_name\`: Full insurer name
  - \`naic_code\`: NAIC number

### 📋 POLICY EXTRACTION RULES

For each policy in the COVERAGES section:
- **CRITICAL**: Carefully read the \`INSR LTR\` column for each policy row. This is the first column in the coverage table.
- Extract the exact letter (A, B, C, D, E, F, etc.) from the \`INSR LTR\` column - **DO NOT MAP TO INSURER NAME**
- **DOUBLE-CHECK**: Make sure you're reading the correct letter for each policy row. Each policy should have its own unique INSR LTR value.
- **IMPORTANT**: Do NOT assume alphabetical order or patterns. Read the actual letter from the INSR LTR column for each policy.
- Just return the letter as-is in the \`insurer_letter\` field
- Extract all other policy information (type, number, dates, coverages)
- Normalize dollar values (e.g., \`$1,000,000\` → \`1000000\`)
- Use \`limit_type\` for the coverage label (e.g., \`"EACH OCCURRENCE"\`, \`"MED EXP"\`)
- **CRITICAL RULE**: If a coverage limit value is 0, null, empty, or shows only "$" with no amount, DO NOT include that coverage in the results. Skip it entirely.
- **NULL VALUES**: If any field has no information, use \`null\` instead of empty strings \`""\`

### 🎯 CERTIFICATE HOLDER EXTRACTION

- **certificate_holder**: Extract **ONLY the first line** under the "CERTIFICATE HOLDER" section. This should be just the business name (e.g., "JanCo FS 3, LLC Dba Velociti Services"). Do NOT include any address lines.

### 🎯 SPECIFIC INSTRUCTIONS FOR PRODUCER INFORMATION

- **full_name**: Extract the **contact person's name** from the **"NAME" field** under the PRODUCER section. This should be a real person's name (like "John Smith", "Jane Doe"). If the NAME field is blank or contains a business name, return null.

- **doing_business_as**: Extract the **agency/brokerage name** from the **first line directly underneath the "PRODUCER" title** on the form. This is the business name of the insurance agency (like "TechInsurance", "ABC Insurance Agency"). If no value is present, return null.

- **email_address**: Extract from the "E-MAIL ADDRESS" field. If blank, return null.

### 📞 PHONE NUMBER NORMALIZATION (CRITICAL)

- **fax_number**: Extract from the "FAX" field and normalize (remove formatting). If blank, return null.

- **license_number**: Extract from the **"License#" field in the INSURED section** (not the PRODUCER section). This field is typically located near the top of the form, often in the upper left area. Extract the numeric value (e.g., "3000645669"). **IMPORTANT**: If the field is blank, return null.

### 🧾 RETURN THIS JSON STRUCTURE

Return ONLY the JSON data in this exact format, enclosed in {}:

{
  "certificate_information": {
    "certificate_holder": "string",
    "certificate_number": "string",
    "revision_number": "string or null",
    "issue_date": "MM/DD/YYYY"
  },
  "insurers": [
    {
      "insurer_letter": "string (A, B, C, etc.)",
      "insurer_name": "string",
      "naic_code": "string"
    }
  ],
  "policies": [
    {
      "policy_information": {
        "policy_type": "string",
        "policy_number": "string",
        "effective_date": "MM/DD/YYYY",
        "expiry_date": "MM/DD/YYYY"
      },
      "insurer_letter": "string (A, B, C, etc.)",
      "coverages": [
        {
          "limit_type": "string",
          "limit_value": number
        }
      ]
    }
  ],
  "producer_information": {
    "primary_details": {
      "full_name": "string or null",
      "email_address": "string or null",
      "doing_business_as": "string or null"
    },
    "contact_information": {
      "phone_number": "string (digits only, no formatting)",
      "fax_number": "string (digits only, no formatting) or null",
      "license_number": "string or null"
    },
    "address_details": {
      "address_line_1": "string",
      "address_line_2": "string or null",
      "address_line_3": "string or null",
      "city": "string",
      "state": "string",
      "zip_code": "string",
      "country": "USA"
    }
  }
}

---
IMPORTANT: If the provided document is NOT an ACORD 25 Certificate of Liability Insurance (COI) form, or if you are not at least 95% certain it is, return only null. Do NOT attempt to extract or hallucinate any data. If in doubt, return null. Do NOT return any other text, explanation, or JSON structure. Just return null.
`;

  // Retry with basic exponential backoff
  const MAX_RETRIES = 3;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < MAX_RETRIES) {
    try {
      const googleProvider = createGoogleGenerativeAI({ apiKey: GEMINI_API_KEY });
      const { object } = await generateObject({
        model: googleProvider('gemini-2.5-flash-lite'),
        schema: AcordSchema.nullable(),
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'file', data: pdfBytes, mediaType: 'application/pdf' },
            ],
          },
        ],
      });

      return object;
    } catch (err) {
      lastError = err;
      attempt += 1;
      if (attempt < MAX_RETRIES) {
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw new Error(
    `Failed to get response from Gemini via AI SDK after ${MAX_RETRIES} attempts: ${String(
      (lastError as Error | undefined)?.message || lastError
    )}`
  );
}

export async function POST(req: NextRequest) {
  try {
    // Parse file upload from form-data
    const formData = await req.formData();

    // Validate file type
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Uploaded file must be a PDF' }, { status: 400 });
    }

    // Constrain upload size to keep memory usage low for concurrency
    const maxBytes = 4 * 1024 * 1024; // 4 MB
    if (file.size > maxBytes) {
      return NextResponse.json({ error: 'File too large. Max 4MB.' }, { status: 400 });
    }

    // In-memory processing to improve concurrency
    const originalBytes = new Uint8Array(await file.arrayBuffer());
    const processedBytes = await truncatePDFToFivePagesBuffer(originalBytes);

    // Call Gemini via Next.js AI SDK
    const json = await callGeminiUsingAiSdk(processedBytes);
    return NextResponse.json({ data: json });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const normalizedMessage = message.includes('GEMINI_API_KEY')
      ? 'API key configuration error'
      : message.includes('not a valid PDF')
      ? 'The uploaded file is not a valid PDF'
      : `Error processing PDF: ${message}`;

    return NextResponse.json({ error: normalizedMessage }, { status: 400 });
  }
}
