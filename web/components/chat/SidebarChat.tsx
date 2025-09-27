"use client"
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SkeletonText } from '../ui/Skeleton'
import BarChart from '../dashboard/BarChart'

type Citation = {
  source: string
  title: string
  url?: string
  date?: string
  relevance?: number
}

type ChartData = {
  type: 'bar' | 'line'
  labels: string[]
  series: Array<{ name: string; values: number[]; color: string }>
}

type Msg = {
  role: 'user' | 'assistant'
  text: string
  citations?: Citation[]
  chart?: ChartData
  metadata?: {
    policy?: string
    resultsCount?: number
    timestamp?: string
  }
}

export default function SidebarChat({
  apiBase,
  onAnalysis,
  setAnalysisLoading,
  appendGlobalCitations,
}: {
  apiBase: string
  onAnalysis: (res: any) => void
  setAnalysisLoading: (v: boolean) => void
  appendGlobalCitations: (c: any[]) => void
}) {
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [input, setInput] = React.useState('Which WASH and livelihoods projects across Eastern Sudan (Kassala, Gedaref, Red Sea) since 2020 show sustained outcomes, and which partners delivered the most reliable results?')
  const [maxResults, setMaxResults] = React.useState<number>(60)
  const [strict, setStrict] = React.useState<boolean>(true)
  const [policy, setPolicy] = React.useState<'inclusive'|'exclusive'|'proportional'>('inclusive')
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string>('')

  // Format citations from API response
  const formatCitations = (citations: any[]): Citation[] => {
    return citations.map((c: any) => ({
      source: c.source || 'Unknown Source',
      title: c.title || c.text?.substring(0, 100) + '...' || 'Untitled',
      url: c.url,
      date: c.date,
      relevance: c.score || c.relevance
    }))
  }

  // Extract chart data from analytics response or text content
  const extractChartData = (analyticsResult: any, textContent?: string): ChartData | undefined => {
    // Method 1: Standard chart format from analytics API
    if (analyticsResult.chart && analyticsResult.chart.labels && analyticsResult.chart.series) {
      return {
        type: 'bar',
        labels: analyticsResult.chart.labels,
        series: analyticsResult.chart.series.map((s: any, idx: number) => ({
          ...s,
          color: s.color || ['#60a5fa', '#1f2937', '#0ea5e9', '#10b981', '#f59e0b'][idx % 5]
        }))
      }
    }

    // Method 2: Extract JSON data from text content
    if (textContent) {
      try {
        // Look for JSON objects in the text
        const jsonMatch = textContent.match(/\{[\s\S]*?\}/)
        if (jsonMatch) {
          const jsonData = JSON.parse(jsonMatch[0])

          // Check for labels + budgetCHF format
          if (jsonData.labels && jsonData.budgetCHF && Array.isArray(jsonData.labels) && Array.isArray(jsonData.budgetCHF)) {
            return {
              type: 'bar',
              labels: jsonData.labels,
              series: [{
                name: 'Budget (CHF)',
                values: jsonData.budgetCHF,
                color: '#60a5fa'
              }]
            }
          }

          // Check for labels + values format
          if (jsonData.labels && jsonData.values && Array.isArray(jsonData.labels) && Array.isArray(jsonData.values)) {
            return {
              type: 'bar',
              labels: jsonData.labels,
              series: [{
                name: 'Values',
                values: jsonData.values,
                color: '#60a5fa'
              }]
            }
          }

          // Check for labels + series format
          if (jsonData.labels && jsonData.series && Array.isArray(jsonData.labels)) {
            return {
              type: 'bar',
              labels: jsonData.labels,
              series: jsonData.series.map((s: any, idx: number) => ({
                name: s.name || 'Data',
                values: s.values || [],
                color: s.color || ['#60a5fa', '#1f2937', '#0ea5e9', '#10b981', '#f59e0b'][idx % 5]
              }))
            }
          }
        }
      } catch (e) {
        // JSON parsing failed, ignore
      }
    }

    // Method 3: Check for table-like data in analytics result
    if (analyticsResult.table && Array.isArray(analyticsResult.table)) {
      const table = analyticsResult.table
      if (table.length > 0 && table[0].region && table[0].budget_chf) {
        return {
          type: 'bar',
          labels: table.map((row: any) => row.region),
          series: [{
            name: 'Budget (CHF)',
            values: table.map((row: any) => row.budget_chf || 0),
            color: '#60a5fa'
          }]
        }
      }
    }

    return undefined
  }

  async function send() {
    const q = input.trim()
    if (!q || sending) return

    setSending(true)
    setError('')
    setMessages(m => [...m, { role: 'user', text: q }])
    setInput('')

    try {
      // 1) Chat answer (pure text) for the sidebar
      const r = await fetch(`${apiBase}/api/vectorstore/rag/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, top_k: maxResults, strict })
      })

      if (!r.ok) {
        throw new Error(`API Error: ${r.status} ${r.statusText}`)
      }

      const j = await r.json()
      const answer = typeof j.answer === 'string' ? j.answer : JSON.stringify(j)
      const citations = Array.isArray(j.citations) ? formatCitations(j.citations) : []

      // 2) Analytics result to drive charts and dashboard
      setAnalysisLoading(true)
      const a = await fetch(`${apiBase}/api/vectorstore/analytics/prompt/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q, policy, strict, top_k: maxResults })
      })

      let chartData: ChartData | undefined
      let analyticsResult: any = {}

      if (a.ok) {
        analyticsResult = await a.json()
        chartData = extractChartData(analyticsResult, answer)
        onAnalysis(analyticsResult)

        // Merge citations from both sources
        if (Array.isArray(analyticsResult.citations)) {
          const analyticsCitations = formatCitations(analyticsResult.citations)
          citations.push(...analyticsCitations)
          appendGlobalCitations(analyticsResult.citations)
        }
      }

      // If no chart from analytics, try to extract from text answer alone
      if (!chartData) {
        chartData = extractChartData({}, answer)
      }

      // Add assistant message with enhanced data
      setMessages(m => [...m, {
        role: 'assistant',
        text: answer,
        citations: citations.length > 0 ? citations : undefined,
        chart: chartData,
        metadata: {
          policy: policy,
          resultsCount: citations.length,
          timestamp: new Date().toISOString()
        }
      }])

      if (Array.isArray(j.citations)) appendGlobalCitations(j.citations)

    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Unknown error occurred'
      setError(errorMsg)
      setMessages(m => [...m, {
        role: 'assistant',
        text: `**Error**: ${errorMsg}\n\nPlease check your connection and try again. If the problem persists, contact the system administrator.`,
        metadata: {
          timestamp: new Date().toISOString()
        }
      }])
    } finally {
      setSending(false)
      setAnalysisLoading(false)
    }
  }

  // Component to render citations
  const CitationsSection = ({ citations }: { citations: Citation[] }) => (
    <div className="mt-3 pt-3 border-t border-gray-700">
      <h4 className="text-xs font-semibold text-gray-400 mb-2">📚 Sources ({citations.length})</h4>
      <div className="space-y-1">
        {citations.slice(0, 5).map((citation, idx) => (
          <div key={idx} className="text-xs text-gray-400 bg-gray-900/50 rounded p-2">
            <div className="font-medium text-gray-300">{citation.title}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-gray-500">{citation.source}</span>
              {citation.date && <span className="text-gray-500">• {citation.date}</span>}
              {citation.relevance && (
                <span className="ml-auto text-xs bg-blue-600/20 text-blue-400 px-1 rounded">
                  {Math.round(citation.relevance * 100)}%
                </span>
              )}
            </div>
          </div>
        ))}
        {citations.length > 5 && (
          <div className="text-xs text-gray-500 text-center py-1">
            +{citations.length - 5} more sources
          </div>
        )}
      </div>
    </div>
  )

  // Component to render metadata
  const MetadataSection = ({ metadata }: { metadata: any }) => (
    <div className="mt-2 text-xs text-gray-500 flex gap-3">
      {metadata.policy && <span>Policy: {metadata.policy}</span>}
      {metadata.resultsCount && <span>Results: {metadata.resultsCount}</span>}
      {metadata.timestamp && (
        <span>Time: {new Date(metadata.timestamp).toLocaleTimeString()}</span>
      )}
    </div>
  )

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">🤖 Humanitarian Knowledge Assistant</div>
        <div className="text-xs text-gray-400">Ask questions about SDC projects, budgets, and humanitarian data</div>
      </div>
      <div className="card-body space-y-3">
        {/* Error Alert */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded p-3 text-sm text-red-300">
            <div className="font-semibold">⚠️ Connection Error</div>
            <div className="text-xs mt-1">{error}</div>
          </div>
        )}

        {/* Input Area */}
        <div className="space-y-2">
          <textarea
            className="w-full h-24 rounded bg-gray-900 border border-gray-800 p-3 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none"
            placeholder="Ask about humanitarian projects, budget allocations, regional needs, or compare different contexts..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && e.ctrlKey && send()}
          />
          <div className="text-xs text-gray-500">Press Ctrl+Enter to send</div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs bg-gray-900/50 rounded p-2">
          <label className="text-gray-400">Policy:</label>
          <select
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
            value={policy}
            onChange={e => setPolicy(e.target.value as any)}
          >
            <option value="inclusive">Inclusive</option>
            <option value="exclusive">Exclusive</option>
            <option value="proportional">Proportional</option>
          </select>

          <label className="flex items-center gap-1 text-gray-400">
            <input
              type="checkbox"
              checked={strict}
              onChange={e => setStrict(e.target.checked)}
              className="rounded"
            />
            Strict
          </label>

          <label className="text-gray-400">Max:</label>
          <input
            type="number"
            className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300"
            min={10}
            max={200}
            value={maxResults}
            onChange={e => setMaxResults(parseInt(e.target.value || '60', 10))}
          />

          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="ml-auto px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded text-white transition-colors"
          >
            {sending ? '🔄 Analyzing...' : '🚀 Run'}
          </button>

          <button
            onClick={() => { setMessages([]); setError('') }}
            className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors"
          >
            🗑️ Clear
          </button>
        </div>

        {/* Messages Area */}
        <div className="h-96 overflow-auto rounded bg-gray-900 border border-gray-800 p-3 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <div className="text-4xl mb-2">🤖</div>
              <div className="text-sm">Ask me about humanitarian projects and data</div>
              <div className="text-xs mt-2 text-gray-600">
                Example: "What are the funding gaps in Darfur region?"
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`${m.role === 'user' ? 'text-right' : ''}`}>
                <div className={`inline-block max-w-full rounded-lg ${
                  m.role === 'user'
                    ? 'bg-blue-900/40 px-3 py-2'
                    : 'bg-gray-800 p-4 w-full'
                }`}>
                  {m.role === 'user' ? (
                    <div className="text-sm">{m.text}</div>
                  ) : (
                    <div className="space-y-3">
                      {/* Main Response */}
                      <div className="prose prose-sm prose-invert max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            // Style table elements
                            table: ({ children }) => (
                              <table className="w-full text-xs border-collapse border border-gray-600">
                                {children}
                              </table>
                            ),
                            th: ({ children }) => (
                              <th className="border border-gray-600 px-2 py-1 bg-gray-700 text-left">
                                {children}
                              </th>
                            ),
                            td: ({ children }) => (
                              <td className="border border-gray-600 px-2 py-1">{children}</td>
                            ),
                            // Style code blocks
                            code: ({ children }) => (
                              <code className="bg-gray-900 px-1 py-0.5 rounded text-xs">
                                {children}
                              </code>
                            ),
                            // Style lists
                            ul: ({ children }) => (
                              <ul className="list-disc list-inside space-y-1">{children}</ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal list-inside space-y-1">{children}</ol>
                            )
                          }}
                        >
                          {m.text}
                        </ReactMarkdown>
                      </div>

                      {/* Chart if available */}
                      {m.chart && (
                        <div className="bg-gray-900/50 rounded p-3">
                          <h4 className="text-xs font-semibold text-gray-400 mb-2">📊 Data Visualization</h4>
                          <BarChart
                            height={250}
                            labels={m.chart.labels}
                            series={m.chart.series}
                            labelTruncate={15}
                            labelAngle={-45}
                          />
                          <div className="mt-2 text-xs text-gray-500">
                            Showing {m.chart.labels.length} items • Total: {m.chart.series[0]?.values.reduce((sum: number, val: number) => sum + val, 0).toLocaleString()} CHF
                          </div>
                        </div>
                      )}

                      {/* Citations */}
                      {m.citations && m.citations.length > 0 && (
                        <CitationsSection citations={m.citations} />
                      )}

                      {/* Metadata */}
                      {m.metadata && <MetadataSection metadata={m.metadata} />}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {sending && (
            <div className="text-center py-4">
              <div className="inline-flex items-center gap-2 text-gray-400">
                <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                Analyzing humanitarian data...
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

