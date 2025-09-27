'use client'
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Msg = { role: 'user' | 'assistant', text: string }

export default function ChatPage() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
  const [messages, setMessages] = React.useState<Msg[]>([])
  const [input, setInput] = React.useState('')
  const [maxResults, setMaxResults] = React.useState<number>(15)
  const [strict, setStrict] = React.useState<boolean>(false)

  const ask = async () => {
    const q = input.trim()
    if (!q) return
    setMessages(m => [...m, { role: 'user', text: q }])
    setInput('')
    const r = await fetch(`${apiBase}/api/vectorstore/rag/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, top_k: maxResults, strict }),
    })
    const j = await r.json()
    const answer = typeof j.answer === 'string' ? j.answer : JSON.stringify(j)
    // Show pure result only (no UI-appended citations or wrappers)
    setMessages(m => [...m, { role: 'assistant', text: answer }])
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">RAG Chat</h2>
      <div className="border rounded p-3 h-96 overflow-auto bg-white">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div className={`inline-block px-3 py-2 rounded mb-2 ${m.role === 'user' ? 'bg-blue-100' : 'bg-gray-100'}`}>
              {m.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input className="flex-1 border rounded px-3 py-2" value={input} onChange={e => setInput(e.target.value)} placeholder="Ask a question..." />
        <label className="text-sm text-gray-600">Max results</label>
        <input
          type="number"
          min={1}
          max={100}
          className="w-24 border rounded px-2 py-2"
          value={maxResults}
          onChange={e => setMaxResults(parseInt(e.target.value || '15', 10))}
          title="Number of results to retrieve"
        />
        <label className="text-sm text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={strict} onChange={e => setStrict(e.target.checked)} />
          Strict
        </label>
        <button onClick={() => setMessages([])} title="Clear chat">Clear</button>
        <button onClick={ask}>Send</button>
      </div>
      <p className="text-xs text-gray-500">Tip: Ask “list the first 12 … show EDA project IDs, titles, start/end dates, budget” to get a structured table. Use the selector to cap results.</p>
    </div>
  )
}
