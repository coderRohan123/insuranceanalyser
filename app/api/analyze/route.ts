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

  const prompt = `You are an information extraction system. Return EXACTLY ONE of:\n- null\n- A single JSON object matching the schema below\n\nNever include code fences, markdown, comments, or any extra text.\n\nCRITICAL VALIDATION\n- Determine if the document is a genuine ACORD 25 Certificate of Liability Insurance (COI).\n- You MUST be ≥95% certain.\n- If <95% certain or not ACORD 25, return only: null\n\nHow to identify ACORD 25\n- Look for: "Certificate of Liability Insurance", "ACORD 25", "INSURER(S) AFFORDING COVERAGE", "CERTIFICATE HOLDER", "PRODUCER", "POLICY NUMBER", "EFFECTIVE DATE", "LIABILITY", etc.\n- If these terms are missing or the form is a different type, return null.\n\nSCOPE\n- Read and use ONLY the first five (5) pages of the PDF.\n- If information is not visible on those pages, treat it as missing.\n\nEXTRACTION RULES\n- If any field is missing/unclear, use null (never invent values).\n- Policy rows:\n  - Read insurer letter from the INSR LTR column. It must be a single uppercase letter (A–F typically). Do not map to insurer name. If missing/uncertain, skip that policy row.\n  - Extract policy type, policy number, effective date, expiry date.\n- Coverages:\n  - Use limit_type as the exact label text from the form (e.g., "EACH OCCURRENCE", "MED EXP").\n  - Normalize amounts: "$1,000,000" -> 1000000 (number). Remove "$", commas, and spaces.\n  - Skip any coverage with 0, blank, null, or just a "$" symbol (do not include it).\n- Certificate holder:\n  - Return ONLY the first line under "CERTIFICATE HOLDER" (business name only; no address lines).\n- Producer info:\n  - full_name: person’s name from the NAME field under PRODUCER; if blank or a business name, use null.\n  - doing_business_as: agency/brokerage name from the first line directly beneath "PRODUCER"; null if absent.\n  - email_address: from "E-MAIL ADDRESS"; null if absent.\n- Contact normalization:\n  - phone_number: digits only, no formatting (e.g., "1234567890").\n  - fax_number: digits only or null if absent.\n  - license_number: numeric value from the "License#" field in the INSURED section; null if absent.\n- Dates: format as MM/DD/YYYY.\n- NAIC: digits only; if not clearly digits, use null.\n- Insurers array: read from “INSURER(S) AFFORDING COVERAGE”. Include each available row (A, B, C, …) with letter, name, and NAIC.\n\nOUTPUT SCHEMA (return only this JSON object or null)\n{\n  "certificate_information": {\n    "certificate_holder": "string",\n    "certificate_number": "string",\n    "revision_number": "string or null",\n    "issue_date": "MM/DD/YYYY"\n  },\n  "insurers": [\n    {\n      "insurer_letter": "string (A, B, C, etc.)",\n      "insurer_name": "string",\n      "naic_code": "string or null"\n    }\n  ],\n  "policies": [\n    {\n      "policy_information": {\n        "policy_type": "string",\n        "policy_number": "string",\n        "effective_date": "MM/DD/YYYY",\n        "expiry_date": "MM/DD/YYYY"\n      },\n      "insurer_letter": "string (A, B, C, etc.)",\n      "coverages": [\n        {\n          "limit_type": "string",\n          "limit_value": number\n        }\n      ]\n    }\n  ],\n  "producer_information": {\n    "primary_details": {\n      "full_name": "string or null",\n      "email_address": "string or null",\n      "doing_business_as": "string or null"\n    },\n    "contact_information": {\n      "phone_number": "string",\n      "fax_number": "string or null",\n      "license_number": "string or null"\n    },\n    "address_details": {\n      "address_line_1": "string",\n      "address_line_2": "string or null",\n      "address_line_3": "string or null",\n      "city": "string",\n      "state": "string",\n      "zip_code": "string",\n      "country": "USA"\n    }\n  }\n}\n\nSTRICT OUTPUT RULES\n- Return ONLY null or the JSON object above.\n- No markdown, no code block fences, no explanations, no trailing commas.\n- If unsure about ACORD 25 (confidence <95%), return null.`;

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
