'use client';

import { useState, useRef } from 'react';
import { PDFDocument } from 'pdf-lib';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, X, Loader2 } from 'lucide-react';

type AnalysisResponse = Record<string, unknown> | null;

export default function PDFAnalyzerPage() {
  const [json, setJson] = useState<AnalysisResponse>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setChosenFile = (file: File | undefined | null) => {
    setFileName(file?.name || '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      if (file) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInputRef.current.files = dataTransfer.files;
      }
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setChosenFile(file);
  };

  const handleDrop = async (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') {
      setChosenFile(file);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setJson(null); setError(null); setLoading(true);

    // const form = event.currentTarget; // Removed unused variable
    const originalFile = fileInputRef.current?.files?.[0] || null;
    const formData = new FormData();
    try {
      if (!originalFile) {
        throw new Error('Please select a PDF file');
      }

      // Client-side truncate to first 5 pages to save bandwidth and server memory
      let fileToSend: File = originalFile;
      try {
        const bytes = new Uint8Array(await originalFile.arrayBuffer());
        const originalPdf = await PDFDocument.load(bytes);
        const pageCount = originalPdf.getPageCount();
        if (pageCount > 5) {
          const newPdf = await PDFDocument.create();
          const indices = [0,1,2,3,4];
          const copy = await newPdf.copyPages(originalPdf, indices.filter(i => i < pageCount));
          copy.forEach(p => newPdf.addPage(p));
          const out = await newPdf.save();
          const outBlob = new Blob([new Uint8Array(out)], { type: 'application/pdf' });
          fileToSend = new File([outBlob], originalFile.name.replace(/\.pdf$/i, '') + '.first5.pdf', {
            type: 'application/pdf',
          });
        }
      } catch (clientPdfErr) {
        // If client truncation fails for any reason, fall back to original file
        console.warn('Client-side truncation failed, sending original file:', clientPdfErr);
      }

      // Populate form data (append file only; other fields can be added if needed later)
      formData.append('file', fileToSend);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });
      const result: { data?: AnalysisResponse; error?: string } = await res.json();
      if (result.error) throw new Error(result.error);
      setJson(result.data ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setJson(null);
    setError(null);
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Card className="p-8 shadow-xl border border-slate-700 bg-slate-900/90 text-slate-100">
          <div className="text-center mb-8">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-sky-400 to-indigo-400">ACORD 25 Certificate Analyzer</h1>
            <p className="mt-2 text-slate-300">Upload a PDF; we&apos;ll validate it&apos;s ACORD 25 and extract structured data.</p>
          </div>

          <form onSubmit={handleSubmit} encType="multipart/form-data" className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="file" className="text-sm font-medium text-slate-200">Upload ACORD 25 Certificate of Insurance (PDF)</Label>
              <label
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                htmlFor="file"
                className={[
                  'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 cursor-pointer transition',
                  isDragOver ? 'border-sky-400 bg-slate-800/70' : 'border-slate-600 hover:bg-slate-800/50',
                ].join(' ')}
              >
                <Upload className="h-6 w-6 text-sky-400" />
                <div className="text-center">
                  <p className="text-slate-200 font-medium">Drag & drop your PDF here</p>
                  <p className="text-slate-400 text-sm">or click to browse</p>
                </div>
                <Input
                  ref={fileInputRef}
                  id="file"
                  name="file"
                  type="file"
                  accept="application/pdf"
                  required
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              {fileName && (
                <div className="flex items-center justify-between rounded-md bg-slate-800/70 border border-slate-700 px-3 py-2">
                  <p className="text-slate-300 text-sm truncate">Selected: {fileName}</p>
                  <Button type="button" variant="ghost" className="h-8 px-2 text-slate-300 hover:text-white" onClick={resetForm} aria-label="Clear file">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <Button type="submit" disabled={loading || !fileName} className="w-full bg-sky-500 hover:bg-sky-600">
              {loading ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Analyzing...</span>
              ) : (
                'Analyze Certificate'
              )}
            </Button>
          </form>

          {loading && (
            <div className="mt-6 text-center">
              <div className="animate-pulse flex flex-col items-center">
                <div className="h-4 bg-slate-700 rounded w-3/4 mb-2"></div>
                <div className="h-4 bg-slate-700 rounded w-1/2"></div>
              </div>
              <p className="mt-4 text-slate-300">Analyzing your certificate. This may take a moment...</p>
            </div>
          )}

          {error && (
            <div className="mt-6 p-4 bg-red-900/30 border border-red-700 rounded-md">
              <p className="text-red-300 font-medium">Error</p>
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          )}

          {json === null && !loading && !error && (
            <div className="mt-6 p-4 bg-slate-800/70 border border-slate-700 rounded-md">
              <p className="text-slate-300">Upload an ACORD 25 Certificate of Insurance to analyze its contents.</p>
            </div>
          )}

          {json && (
            <div className="mt-8">
              <h2 className="text-xl font-semibold mb-3 text-slate-100">Analysis Results</h2>
              <pre className="bg-slate-950 text-slate-100 p-4 rounded-md overflow-auto text-sm whitespace-pre-wrap border border-slate-800 shadow-inner max-h-[60vh]">
                {JSON.stringify(json, null, 2)}
              </pre>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}