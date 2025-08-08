# ACORD 25 Certificate Analyzer

A Next.js application that analyzes ACORD 25 Certificate of Liability Insurance forms using AI. Upload a PDF and get structured data extraction with validation.

## Features

- **Client-side PDF Processing**: Truncates PDFs to first 5 pages in the browser before upload
- **AI-Powered Analysis**: Uses Google Gemini 2.5 Flash Lite via Next.js AI SDK
- **Strict Validation**: Only processes genuine ACORD 25 COI forms (≥95% confidence)
- **High Concurrency**: Edge runtime supports 100+ simultaneous users
- **Modern UI**: Dark theme with drag-and-drop file upload

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **AI**: Google Gemini via @ai-sdk/google
- **PDF Processing**: pdf-lib for client-side truncation
- **Styling**: Tailwind CSS
- **Type Safety**: TypeScript
- **Validation**: Zod schema validation

## Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/coderRohan123/insuranceanalyser.git
   cd insuranceanalyser
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env.local` file:
   ```env
   GEMINI_API_KEY=your_google_gemini_api_key_here
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```

5. **Open your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1. Upload an ACORD 25 Certificate of Insurance PDF
2. The app will automatically truncate it to the first 5 pages
3. AI analyzes the document and extracts structured data
4. View the results in JSON format

## API Endpoints

- `POST /api/analyze`: Analyzes uploaded PDF and returns structured data

## Deployment

This project is optimized for deployment on Vercel:

1. Connect your GitHub repository to Vercel
2. Set the `GEMINI_API_KEY` environment variable
3. Deploy automatically on push to main branch

## Project Structure

```
├── app/
│   ├── api/analyze/route.ts    # AI analysis endpoint
│   ├── page.tsx                # Main UI component
│   └── layout.tsx              # Root layout
├── components/ui/              # Reusable UI components
├── lib/utils.ts               # Utility functions
└── package.json               # Dependencies
```

## Learn More

To learn more about the technologies used:

- [Next.js Documentation](https://nextjs.org/docs)
- [Next.js AI SDK](https://sdk.vercel.ai/docs)
- [Google Gemini API](https://ai.google.dev/)
- [Tailwind CSS](https://tailwindcss.com/)

## License

This project is open source and available under the [MIT License](LICENSE).
