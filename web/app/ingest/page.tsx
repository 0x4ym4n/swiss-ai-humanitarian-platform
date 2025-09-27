'use client'
import React from 'react'
import { useRouter } from 'next/navigation'

interface IngestionStep {
  id: string
  label: string
  status: 'pending' | 'processing' | 'completed' | 'error'
}

interface UploadedFile {
  name: string
  size: number
  type: string
  content?: string
}

export default function IngestPage() {
  const router = useRouter()
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'

  // Form states
  const [source, setSource] = React.useState('manual')
  const [title, setTitle] = React.useState('')
  const [text, setText] = React.useState('')
  const [attachments, setAttachments] = React.useState<string>('')
  const [lang, setLang] = React.useState('auto')
  const [uploadedFiles, setUploadedFiles] = React.useState<UploadedFile[]>([])
  const [isDragOver, setIsDragOver] = React.useState(false)

  // UI states
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [currentStep, setCurrentStep] = React.useState<string>('')
  const [progress, setProgress] = React.useState(0)
  const [showSuccess, setShowSuccess] = React.useState(false)
  const [error, setError] = React.useState<string>('')
  const [result, setResult] = React.useState<any>(null)

  const steps: IngestionStep[] = [
    { id: 'validation', label: 'Validating input', status: 'pending' },
    { id: 'processing', label: 'Processing content', status: 'pending' },
    { id: 'embedding', label: 'Generating embeddings', status: 'pending' },
    { id: 'indexing', label: 'Indexing to vector store', status: 'pending' },
    { id: 'complete', label: 'Ingestion complete', status: 'pending' }
  ]

  const [stepStatuses, setStepStatuses] = React.useState<IngestionStep[]>(steps)

  const updateStepStatus = (stepId: string, status: IngestionStep['status']) => {
    setStepStatuses(prev =>
      prev.map(step =>
        step.id === stepId ? { ...step, status } : step
      )
    )
  }

  // File handling functions
  const handleFileUpload = async (files: FileList) => {
    const newFiles: UploadedFile[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        const content = await file.text()
        newFiles.push({
          name: file.name,
          size: file.size,
          type: file.type,
          content
        })

        // Auto-populate text area if it's empty
        if (!text.trim()) {
          setText(content)
        }

        // Auto-populate title if empty
        if (!title.trim()) {
          setTitle(file.name.replace(/\.[^/.]+$/, ""))
        }
      } else {
        newFiles.push({
          name: file.name,
          size: file.size,
          type: file.type
        })
      }
    }

    setUploadedFiles(prev => [...prev, ...newFiles])
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    handleFileUpload(files)
  }

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const simulateProgress = async () => {
    // Validation
    setCurrentStep('Validating input...')
    updateStepStatus('validation', 'processing')
    setProgress(20)
    await new Promise(resolve => setTimeout(resolve, 800))
    updateStepStatus('validation', 'completed')

    // Processing
    setCurrentStep('Processing content...')
    updateStepStatus('processing', 'processing')
    setProgress(40)
    await new Promise(resolve => setTimeout(resolve, 1200))
    updateStepStatus('processing', 'completed')

    // Embedding
    setCurrentStep('Generating embeddings...')
    updateStepStatus('embedding', 'processing')
    setProgress(70)
    await new Promise(resolve => setTimeout(resolve, 1500))
    updateStepStatus('embedding', 'completed')

    // Indexing
    setCurrentStep('Indexing to vector store...')
    updateStepStatus('indexing', 'processing')
    setProgress(90)
    await new Promise(resolve => setTimeout(resolve, 1000))
    updateStepStatus('indexing', 'completed')

    // Complete
    setCurrentStep('Ingestion complete!')
    updateStepStatus('complete', 'completed')
    setProgress(100)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsProcessing(true)
    setShowSuccess(false)
    setProgress(0)
    setStepStatuses(steps.map(step => ({ ...step, status: 'pending' })))

    try {
      // Start progress simulation
      const progressPromise = simulateProgress()

      // Prepare payload
      const lines = attachments.split('\n').map(s => s.trim()).filter(Boolean)
      const payload = {
        source,
        title,
        text,
        lang,
        attachments: lines.map(url => ({ url }))
      }

      // Make API call
      const apiPromise = fetch(`${apiBase}/api/vectorstore/ingest/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => r.json())

      // Wait for both to complete
      const [_, apiResult] = await Promise.all([progressPromise, apiPromise])

      setResult(apiResult)
      setShowSuccess(true)

      // Auto-redirect after 3 seconds
      setTimeout(() => {
        router.push('/')
      }, 3000)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during ingestion')
      updateStepStatus(currentStep.split(' ')[0].toLowerCase(), 'error')
    } finally {
      setIsProcessing(false)
    }
  }

  const getStepIcon = (status: IngestionStep['status']) => {
    switch (status) {
      case 'completed':
        return (
          <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )
      case 'processing':
        return (
          <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
            <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
          </div>
        )
      case 'error':
        return (
          <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )
      default:
        return <div className="w-6 h-6 bg-gray-600 rounded-full"></div>
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Ingest Unstructured Project</h1>
        <p className="text-gray-400 mt-2">Add new documents and content to the knowledge base</p>
      </div>

      {/* Success Message */}
      {showSuccess && (
        <div className="card border-green-500/50 bg-green-500/10">
          <div className="card-body">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-green-400">Ingestion Successful!</h3>
                <p className="text-green-300">Content has been successfully added to the knowledge base. Redirecting to dashboard...</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="card border-red-500/50 bg-red-500/10">
          <div className="card-body">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5C2.962 18.333 3.924 20 5.464 20z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-red-400">Ingestion Failed</h3>
                <p className="text-red-300">{error}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Progress Section */}
      {isProcessing && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Processing Content</div>
            <div className="text-sm text-gray-400">{progress}% complete</div>
          </div>
          <div className="card-body space-y-6">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="text-sm text-gray-300">{currentStep}</div>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-4">
              {stepStatuses.map((step, index) => (
                <div key={step.id} className="flex items-center gap-3">
                  {getStepIcon(step.status)}
                  <span className={`text-sm ${
                    step.status === 'completed' ? 'text-green-400' :
                    step.status === 'processing' ? 'text-blue-400' :
                    step.status === 'error' ? 'text-red-400' :
                    'text-gray-400'
                  }`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* File Upload Section */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">📁 Upload Files</div>
          <div className="text-xs text-gray-400">Drag & drop files or click to browse</div>
        </div>
        <div className="card-body">
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragOver
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-600 hover:border-gray-500'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              multiple
              accept=".txt,.md,.pdf,.doc,.docx"
              onChange={e => e.target.files && handleFileUpload(e.target.files)}
              className="hidden"
              id="file-upload"
              disabled={isProcessing}
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <div className="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-lg font-medium text-gray-300 mb-2">
                {isDragOver ? 'Drop files here' : 'Drop files here or click to browse'}
              </p>
              <p className="text-sm text-gray-400">
                Supports: TXT, MD, PDF, DOC, DOCX files
              </p>
            </label>
          </div>

          {/* Uploaded Files List */}
          {uploadedFiles.length > 0 && (
            <div className="mt-6 space-y-3">
              <h4 className="text-sm font-medium text-gray-300">Uploaded Files ({uploadedFiles.length})</h4>
              <div className="space-y-2">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-700">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{file.name}</p>
                        <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="text-red-400 hover:text-red-300 p-1"
                      disabled={isProcessing}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">📄 Document Information</div>
        </div>
        <div className="card-body">
          <form onSubmit={onSubmit} className="space-y-6">
            {/* Source and Title */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                  📚 Source
                </label>
                <input
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-colors"
                  placeholder="e.g., SDC Report, Field Study, Internal Document"
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  disabled={isProcessing}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                  📝 Title <span className="text-red-400">*</span>
                </label>
                <input
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-colors"
                  placeholder="Enter document title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  disabled={isProcessing}
                  required
                />
              </div>
            </div>

            {/* Language and Attachments */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                  🌍 Language
                </label>
                <select
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none transition-colors"
                  value={lang}
                  onChange={e => setLang(e.target.value)}
                  disabled={isProcessing}
                >
                  <option value="auto">🤖 Auto-detect language</option>
                  <option value="en">🇺🇸 English</option>
                  <option value="de">🇩🇪 German (Deutsch)</option>
                  <option value="de-ch">🇨🇭 Swiss German (Schweizerdeutsch)</option>
                  <option value="fr">🇫🇷 French (Français)</option>
                  <option value="ar">🇸🇦 Arabic (العربية)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                  🔗 External Links
                </label>
                <textarea
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-colors"
                  placeholder="One URL per line (optional)"
                  rows={3}
                  value={attachments}
                  onChange={e => setAttachments(e.target.value)}
                  disabled={isProcessing}
                />
              </div>
            </div>

            {/* Main Content */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                📋 Content <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <textarea
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none min-h-[250px] transition-colors"
                  placeholder="Paste your content here or upload files above to auto-populate..."
                  rows={15}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  disabled={isProcessing}
                  required
                />
                {text && (
                  <div className="absolute bottom-2 right-2 text-xs text-gray-400 bg-gray-800 px-2 py-1 rounded">
                    {text.length.toLocaleString()} characters
                  </div>
                )}
              </div>
            </div>

            {/* Preview Section */}
            {(title || text || uploadedFiles.length > 0) && (
              <div className="border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                  👀 Preview
                </h4>
                <div className="space-y-2 text-sm">
                  {title && (
                    <div>
                      <span className="text-gray-400">Title:</span>
                      <span className="text-white ml-2">{title}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-400">Source:</span>
                    <span className="text-white ml-2">{source || 'manual'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Language:</span>
                    <span className="text-white ml-2">
                      {lang === 'auto' ? '🤖 Auto-detect' :
                       lang === 'en' ? '🇺🇸 English' :
                       lang === 'de' ? '🇩🇪 German' :
                       lang === 'de-ch' ? '🇨🇭 Swiss German' :
                       lang === 'fr' ? '🇫🇷 French' :
                       lang === 'ar' ? '🇸🇦 Arabic' : lang}
                    </span>
                  </div>
                  {uploadedFiles.length > 0 && (
                    <div>
                      <span className="text-gray-400">Files:</span>
                      <span className="text-white ml-2">{uploadedFiles.length} file(s)</span>
                    </div>
                  )}
                  {text && (
                    <div>
                      <span className="text-gray-400">Content:</span>
                      <span className="text-white ml-2">{text.length} characters</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-700">
              <button
                type="button"
                onClick={() => router.push('/')}
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
                disabled={isProcessing}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
                disabled={isProcessing || !title.trim() || !text.trim()}
              >
                {isProcessing && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                )}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {isProcessing ? 'Processing Document...' : 'Start Ingestion'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Result Display */}
      {result && !isProcessing && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">Ingestion Result</div>
          </div>
          <div className="card-body">
            <pre className="p-4 bg-gray-900 rounded-lg text-sm overflow-auto text-gray-300 border border-gray-700">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}


