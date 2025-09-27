'use client'
import React from 'react'
import useSWR from 'swr'
import StatCard from '../components/dashboard/StatCard'
import BarChart from '../components/dashboard/BarChart'
import DonutChart from '../components/dashboard/DonutChart'
import dynamic from 'next/dynamic'
const SudanMap = dynamic(() => import('../components/dashboard/SudanMap'), { ssr: false })
import { Skeleton, SkeletonText } from '../components/ui/Skeleton'
import SidebarChat from '../components/chat/SidebarChat'
import NewsComponent from '../components/dashboard/NewsComponent'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
  const { data: health } = useSWR(`${apiBase}/api/vectorstore/health/`, fetcher)
  // Prompt-driven datasets (from RAG) — fall back to metrics only if needed
  const [overview, setOverview] = React.useState<any>(null)
  const [partnersChart, setPartnersChart] = React.useState<any>(null)
  const [outcomeRows, setOutcomeRows] = React.useState<any[] | null>(null)
  const [regionChart, setRegionChart] = React.useState<any>(null)
  const [globalCitations, setGlobalCitations] = React.useState<any[]>([])

  const [prompt, setPrompt] = React.useState('Which WASH and livelihoods projects across Eastern Sudan (Kassala, Gedaref, Red Sea) since 2020 show sustained outcomes, and which partners delivered the most reliable results?')
  const [policy, setPolicy] = React.useState<'inclusive'|'exclusive'|'proportional'>('inclusive')
  const [strict, setStrict] = React.useState(false)
  const [analysis, setAnalysis] = React.useState<any>(null)
  const [analysisLoading, setAnalysisLoading] = React.useState(false)
  const [initialLoading, setInitialLoading] = React.useState(true)

  async function runPrompt() {
    setAnalysisLoading(true)
    const r = await fetch(`${apiBase}/api/vectorstore/analytics/prompt/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, policy, strict, top_k: 60 })
    })
    const j = await r.json()
    setAnalysis(j)
    setAnalysisLoading(false)
  }

  // Run a default analysis on first load to hydrate the dashboard
  React.useEffect(() => { runPrompt() }, [])

  // Utilities
  function extractJSON(text: string): any | null {
    try { return JSON.parse(text) } catch {}
    try {
      const m = text.match(/[\[{][\s\S]*[\]}]/)
      if (m) return JSON.parse(m[0])
    } catch {}
    return null
  }

  async function ragJSON(prompt: string, topK = 120, strict = true) {
    const r = await fetch(`${apiBase}/api/vectorstore/rag/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: prompt, top_k: topK, strict }) })
    const j = await r.json()
    const data = extractJSON(j.answer || '')
    return { data, citations: j.citations || [] }
  }

  // Hydrate dashboard with initial structured prompts from Qdrant
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setInitialLoading(true)

        // Summary
        const sumPrompt = `Summarize SDC-funded projects in Sudan.
Return JSON only with: { "total_projects": <number>, "total_budget_chf": <number> }`
        const sumRes = await ragJSON(sumPrompt, 120, true)
        if (!cancelled && sumRes.data) setOverview(sumRes.data)
        if (!cancelled) setGlobalCitations(prev => [...prev, ...(sumRes.citations || [])])

        // Partners chart
        const pPrompt = `From SDC-funded Sudan projects, compute top 7 partners by Swiss budget.
Return JSON only: { "labels": ["<name>"...], "series": [{"name":"Budget","values":[<number CHF>...]}] }`
        const pRes = await ragJSON(pPrompt, 150, true)
        if (!cancelled && pRes.data) setPartnersChart(pRes.data)
        if (!cancelled) setGlobalCitations(prev => [...prev, ...(pRes.citations || [])])

        // Region budgets (inclusive)
        const rbPrompt = `Which regions (states) in Sudan are covered by SDC-funded projects and what are the total budgets for each region?
Use INCLUSIVE totals (count full budget in each region) and label totals as not disaggregated.
Return JSON only: { "labels": ["<Region>"...], "series": [{"name":"Budget (CHF)","values":[<number>...]}] }`
        const rbRes = await ragJSON(rbPrompt, 180, true)
        if (!cancelled && rbRes.data) setRegionChart(rbRes.data)
        if (!cancelled) setGlobalCitations(prev => [...prev, ...(rbRes.citations || [])])

        // Outcome rows
        const rowsPrompt = `List the first 12 SDC-funded projects for Sudan.
Return JSON array only with objects: { "title": string, "partners": string, "budget": string, "period": string, "project_number": string }`
        const rRes = await ragJSON(rowsPrompt, 180, true)
        if (!cancelled && Array.isArray(rRes.data)) setOutcomeRows(rRes.data)
        if (!cancelled) setGlobalCitations(prev => [...prev, ...(rRes.citations || [])])

        if (!cancelled) setInitialLoading(false)
      } catch (e) {
        console.warn('Initial prompt hydration failed', e)
        if (!cancelled) setInitialLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [apiBase])

  // Adapt dashboard based on analysis result
  React.useEffect(() => {
    if (!analysis) return
    if (Array.isArray(analysis.citations)) setGlobalCitations(prev => [...prev, ...analysis.citations])
    if (analysis.table && Array.isArray(analysis.table)) setOutcomeRows(analysis.table)
    if (analysis.chart && analysis.chart.labels && Array.isArray(analysis.chart.labels)) {
      const states = new Set(['Kassala','Gedaref','Red Sea','Khartoum','Blue Nile','White Nile','Sennar','River Nile','Northern','South Kordofan','North Kordofan','West Kordofan','Central Darfur','East Darfur','North Darfur','South Darfur','West Darfur'])
      const lbls: string[] = analysis.chart.labels
      const stateLike = lbls.filter((l)=>states.has(l)).length >= Math.max(1, Math.floor(lbls.length*0.4))
      if (stateLike || analysis.mode === 'region_budgets') setRegionChart(analysis.chart)
      else setPartnersChart(analysis.chart)
    }
  }, [analysis])

  return (
    <div className="min-h-screen space-y-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Main content (3 cols) */}
      <div className="lg:col-span-8 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-white">Hey there, Chris!</h2>
          <div className="text-sm text-gray-400">Here’s the rundown for Today</div>
        </div>

      {/* Top stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {overview ? (
          <>
            <StatCard label="Total projects" value={String(overview.total_projects || 0)} />
            <StatCard label="Estimated active" value={String(overview.active_projects_estimate || 0)} />
            <StatCard label="Total Swiss budget (CHF)" value={new Intl.NumberFormat('en-CH').format(overview.total_budget_chf || 0)} />
          </>
        ) : (
          <>
            <div className="stat"><Skeleton className="h-10 w-10" /><div className="flex-1"><Skeleton className="h-6 w-24" /><Skeleton className="h-3 w-32 mt-2" /></div></div>
            <div className="stat"><Skeleton className="h-10 w-10" /><div className="flex-1"><Skeleton className="h-6 w-24" /><Skeleton className="h-3 w-32 mt-2" /></div></div>
            <div className="stat"><Skeleton className="h-10 w-10" /><div className="flex-1"><Skeleton className="h-6 w-24" /><Skeleton className="h-3 w-32 mt-2" /></div></div>
          </>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Project Location - Full Chart */}
        <div className="xl:col-span-2">
          <div className="card h-full">
            <div className="card-header">
              <div className="card-title">📍 Project Location Analysis</div>
              <div className="text-xs text-gray-400">Regional budget distribution</div>
            </div>
            <div className="card-body">
              <div className="space-y-6">
                {/* Chart Section */}
                <div className="bg-gray-900/50 rounded-lg p-4">
                  <div className="min-h-[280px]">
                    {(initialLoading || analysisLoading) ? (
                      <div className="h-[280px] flex items-center justify-center text-gray-500">
                        <div className="text-center">
                          <div className="w-16 h-16 mx-auto mb-4 bg-blue-600/20 rounded-full flex items-center justify-center">
                            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                          </div>
                          <p className="text-gray-400">
                            {initialLoading ? 'Loading dashboard data...' : 'Loading regional analysis...'}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {initialLoading ? 'Fetching SDC project information from knowledge base' : 'Analyzing SDC project distribution across Sudan'}
                          </p>
                        </div>
                      </div>
                    ) : analysis?.mode === 'region_budgets' && analysis?.chart?.type === 'bar' ? (
                      <BarChart height={280} labels={analysis.chart.labels} series={analysis.chart.series.map((s:any, idx:number)=>({ ...s, color: ['#60a5fa','#1f2937','#0ea5e9'][idx%3]}))} labelTruncate={10} labelAngle={-45} />
                    ) : regionChart ? (
                      <BarChart height={280} labels={regionChart.labels || []} series={(regionChart.series || []).map((s:any, idx:number)=>({ ...s, color: ['#60a5fa','#1f2937','#0ea5e9'][idx%3]}))} labelTruncate={10} labelAngle={-45} />
                    ) : (
                      <div className="h-[280px] flex items-center justify-center text-gray-500">
                        <div className="text-center">
                          <div className="w-16 h-16 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center">
                            <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                          </div>
                          <p className="text-gray-400">No regional data available</p>
                          <p className="text-xs text-gray-500 mt-1">Try asking about regional budgets in the chat</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Legend */}
                  <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-gray-700">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="inline-block h-3 w-3 rounded-full bg-blue-500" />
                      Budget (CHF) - not disaggregated
                    </div>
                  </div>
                </div>

                {/* Filter Controls */}
                <div className="bg-gray-900/30 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-300 mb-4">🔍 Filter by Region</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-gray-400 mb-2 block">Select State</label>
                      <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none">
                        <option>— None —</option>
                        <option>Kassala</option>
                        <option>Khartoum</option>
                        <option>Blue Nile</option>
                        <option>North Darfur</option>
                        <option>South Darfur</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 mb-2 block">Or type state name</label>
                      <input
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                        placeholder="e.g. Kassala"
                      />
                    </div>
                    <div className="flex items-end">
                      <button className="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors text-sm">
                        Reset Filters
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Partner Performance */}
        <div className="xl:col-span-1">
          <div className="card h-full">
            <div className="card-header">
              <div className="card-title">👥 Partner Performance</div>
              <div className="text-xs text-gray-400">Budget allocation by partner</div>
            </div>
            <div className="card-body">
              <div className="bg-gray-900/50 rounded-lg p-4">
                {initialLoading ? (
                  <div className="h-[320px] flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-12 h-12 mx-auto mb-4 bg-blue-600/20 rounded-full flex items-center justify-center">
                        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                      </div>
                      <p className="text-gray-400 text-sm">Loading partners...</p>
                      <p className="text-xs text-gray-500 mt-1">Analyzing budget allocations</p>
                    </div>
                  </div>
                ) : partnersChart ? (
                  <BarChart height={320} labels={partnersChart?.labels || []} series={[{ name: 'Budget', values: partnersChart?.series?.[0]?.values || [], color: '#60a5fa' }]} labelTruncate={20} labelAngle={-45} />
                ) : (
                  <div className="h-[320px] flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-12 h-12 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                      </div>
                      <p className="text-gray-400 text-sm">No partner data available</p>
                      <p className="text-xs text-gray-500 mt-1">Partner information will load automatically</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Map Section */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">🗺️ Sudan Project Map</div>
          <div className="text-xs text-gray-400">Interactive project locations</div>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Map */}
            <div className="lg:col-span-4">
              <div className="bg-gray-900/30 rounded-lg p-4">
                <SudanMap highlightedState={undefined} height={400} />
              </div>
            </div>

            {/* Map Legend & Info */}
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-gray-900/50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  Legend
                </h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="inline-block h-3 w-3 rounded-full bg-blue-500 shadow-lg shadow-blue-500/50" />
                    <span className="text-gray-300">Active Projects</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="inline-block h-3 w-3 rounded-full bg-yellow-400 shadow-lg shadow-yellow-400/50" />
                    <span className="text-gray-300">Under Evaluation</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="inline-block h-3 w-3 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" />
                    <span className="text-gray-300">High Performance</span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900/50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                  📊 Quick Stats
                </h4>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Total Regions:</span>
                    <span className="text-white font-semibold">18</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Active Regions:</span>
                    <span className="text-blue-400 font-semibold">12</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-sm">Coverage:</span>
                    <span className="text-green-400 font-semibold">67%</span>
                  </div>
                  <div className="pt-2 border-t border-gray-700">
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div className="bg-gradient-to-r from-blue-500 to-green-400 h-2 rounded-full" style={{width: '67%'}}></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-900/50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-gray-300 mb-3">🎯 Actions</h4>
                <div className="space-y-2">
                  <button className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors">
                    Generate Report
                  </button>
                  <button className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors">
                    Export Data
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Outcome overview */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">📋 Outcome Overview</div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-gray-400">
              API Status:
              <span className={`ml-1 font-semibold ${health?.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
                {health?.status || 'unknown'}
              </span>
            </div>
            <div className="text-xs text-gray-400">
              Showing 7 of {outcomeRows?.length || 0} projects
            </div>
          </div>
        </div>
        <div className="card-body">
          <div className="bg-gray-900/30 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-800/50">
                  <tr>
                    <th className="text-left text-gray-300 font-medium py-4 px-4 border-b border-gray-700">
                      📄 Project
                    </th>
                    <th className="text-left text-gray-300 font-medium py-4 px-4 border-b border-gray-700">
                      🤝 Partner
                    </th>
                    <th className="text-left text-gray-300 font-medium py-4 px-4 border-b border-gray-700">
                      💰 Budget (CHF)
                    </th>
                    <th className="text-left text-gray-300 font-medium py-4 px-4 border-b border-gray-700">
                      📅 Period
                    </th>
                    <th className="text-left text-gray-300 font-medium py-4 px-4 border-b border-gray-700">
                      🏢 Source
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!outcomeRows ? (
                    Array.from({length:7}).map((_,i)=>(
                      <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/30">
                        <td className="py-4 px-4"><Skeleton className="h-4 w-64" /></td>
                        <td className="py-4 px-4"><Skeleton className="h-4 w-40" /></td>
                        <td className="py-4 px-4"><Skeleton className="h-4 w-24" /></td>
                        <td className="py-4 px-4"><Skeleton className="h-4 w-24" /></td>
                        <td className="py-4 px-4"><Skeleton className="h-4 w-12" /></td>
                      </tr>
                    ))
                  ) : (
                  (outcomeRows || []).slice(0,7).map((row:any, i:number) => (
                    <tr key={i} className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                      <td className="py-4 px-4">
                        <div className="font-medium text-white max-w-xs">
                          {row.title}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="truncate max-w-[200px] text-gray-300" title={row.partners}>
                          {row.partners || '—'}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-mono text-green-400">
                          {row.budget || '—'}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-gray-300 text-sm">
                          {row.period || '—'}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600/20 text-blue-400 rounded-full text-xs font-medium">
                          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
                          SDC
                        </div>
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Enhanced Pagination */}
          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </button>
              <div className="text-sm text-gray-400">
                Page <span className="text-white font-semibold">1</span> of <span className="text-white font-semibold">8</span>
              </div>
              <button className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors flex items-center gap-2">
                Next
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </button>
              <button className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Filter
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Revenue Utilisation */}
        <div className="xl:col-span-3">
          <div className="card h-full">
            <div className="card-header">
              <div className="card-title">💰 Revenue Utilisation</div>
              <div className="text-xs text-gray-400">Partner budget distribution</div>
            </div>
            <div className="card-body">
              <div className="bg-gray-900/30 rounded-lg p-6">
                {partnersChart ? (
                  <DonutChart
                    slices={(partnersChart?.labels || []).map((l:string, idx:number) => ({
                      label: l.length > 15 ? l.substring(0, 15) + '...' : l,
                      value: (partnersChart?.series?.[0]?.values?.[idx] || 0),
                      color: ['#3b82f6','#60a5fa','#93c5fd','#8b5cf6','#0ea5e9','#22d3ee','#10b981'][idx % 7]
                    }))}
                    centerText={'Budget'}
                    size={200}
                    hole={60}
                  />
                ) : (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center animate-pulse">
                        <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                      </div>
                      <p className="text-gray-400">Loading revenue data...</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Raw Data & Actions */}
        <div className="xl:col-span-2">
          <div className="card h-full">
            <div className="card-header">
              <div className="card-title">📊 Data Sources</div>
              <div className="text-xs text-gray-400">Available data files</div>
            </div>
            <div className="card-body">
              <div className="space-y-4">
                {/* Data summary */}
                <DataSourcesSummary apiBase={apiBase} />

                {/* Raw data files */}
                <div className="bg-gray-900/30 rounded-lg p-4 max-h-64 overflow-y-auto">
                  <h4 className="text-sm font-medium text-gray-300 mb-3">📁 Files</h4>
                  <RawDataList apiBase={apiBase} />
                </div>

                {/* Action buttons */}
                <div className="bg-gray-900/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-gray-300 mb-3">⚡ Quick Actions</h4>
                  <div className="grid grid-cols-1 gap-2">
                    <button className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Export Report
                    </button>
                    <button className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh Data
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Right sidebar */}
      <aside className="lg:col-span-4 space-y-8 flex flex-col min-h-screen">
        {/* Chat Component */}
        <SidebarChat
          apiBase={apiBase}
          onAnalysis={(res)=>setAnalysis(res)}
          setAnalysisLoading={setAnalysisLoading}
          appendGlobalCitations={(c)=>setGlobalCitations(prev=>[...prev, ...c])}
        />

        {/* News Component */}
        <div className="flex-1">
          <NewsComponent apiBase={apiBase} />
        </div>
      </aside>
    </div>
  )
}

function RawDataList({ apiBase }: { apiBase: string }) {
  const { data } = useSWR(`${apiBase}/api/vectorstore/sources/index/`, (u)=>fetch(u).then(r=>r.json()))
  if (!data) return <Skeleton className="h-24 w-full" />

  // Filter for project-related JSON datasets only
  const allFiles = data.files || []
  const projectFiles = allFiles.filter((f: any) => {
    const filename = f.name.toLowerCase()
    return (
      filename.endsWith('.json') &&
      !filename.includes('package') &&
      !filename.includes('node_modules') &&
      (
        filename.includes('project') ||
        filename.includes('sudan') ||
        filename.includes('swiss') ||
        filename.includes('reliefweb') ||
        filename.includes('humanitarian') ||
        filename.includes('sdc')
      )
    )
  })

  const fmt = (n:number)=> (n>0? `${(n/1024/1024).toFixed(2)} MB` : '')

  // Get file icon for project datasets
  const getFileIcon = (filename: string) => {
    const name = filename.toLowerCase()
    if (name.includes('news') || name.includes('reliefweb')) return '📰'
    if (name.includes('report') || name.includes('situation')) return '📋'
    if (name.includes('project') || name.includes('swiss') || name.includes('sdc')) return '📊'
    if (name.includes('sudan')) return '🇸🇩'
    return '📄'
  }

  // Get friendly display name
  const getDisplayName = (filename: string) => {
    const name = filename.replace('.json', '')
    if (name.includes('swiss-gov-suudan-projects')) return 'Swiss Government Sudan Projects'
    if (name.includes('reliefweb_news_with_details')) return 'ReliefWeb News Articles'
    if (name.includes('reliefweb_sudan_situation_reports')) return 'Sudan Situation Reports'
    return name.replace(/_/g, ' ').replace(/-/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  if (projectFiles.length === 0) {
    return (
      <div className="text-center py-4">
        <div className="text-gray-400 text-sm">No project datasets found</div>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {projectFiles.map((f:any, i:number)=> (
        <li key={i} className="flex items-center gap-3 p-3 rounded bg-gray-900 hover:bg-gray-800 transition-colors">
          <div className="h-8 w-8 rounded bg-blue-600/20 text-blue-400 flex items-center justify-center text-lg">
            {getFileIcon(f.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-200 truncate" title={getDisplayName(f.name)}>
              {getDisplayName(f.name)}
            </div>
            <div className="text-xs text-gray-400 flex items-center gap-2">
              <span>{fmt(f.size_bytes)}</span>
              <span>•</span>
              <span className="truncate" title={f.name}>{f.name}</span>
            </div>
          </div>
          <a
            className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors flex items-center gap-1"
            href={`${apiBase}${f.url}`}
            download
            title={`Download ${f.name}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </a>
        </li>
      ))}
    </ul>
  )
}

function DataSourcesSummary({ apiBase }: { apiBase: string }) {
  const { data } = useSWR(`${apiBase}/api/vectorstore/sources/index/`, (u)=>fetch(u).then(r=>r.json()))

  if (!data) {
    return (
      <div className="bg-gray-900/50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-300 mb-3">📈 Project Datasets</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><Skeleton className="h-4 w-20" /></div>
          <div><Skeleton className="h-4 w-20" /></div>
          <div><Skeleton className="h-4 w-20" /></div>
          <div><Skeleton className="h-4 w-20" /></div>
        </div>
      </div>
    )
  }

  // Filter for project-related JSON datasets only (same logic as RawDataList)
  const allFiles = data.files || []
  const projectFiles = allFiles.filter((f: any) => {
    const filename = f.name.toLowerCase()
    return (
      filename.endsWith('.json') &&
      !filename.includes('package') &&
      !filename.includes('node_modules') &&
      (
        filename.includes('project') ||
        filename.includes('sudan') ||
        filename.includes('swiss') ||
        filename.includes('reliefweb') ||
        filename.includes('humanitarian') ||
        filename.includes('sdc')
      )
    )
  })

  const totalSize = projectFiles.reduce((sum: number, f: any) => sum + (f.size_bytes || 0), 0)
  const totalSizeMB = totalSize > 0 ? (totalSize / 1024 / 1024).toFixed(1) : '0'

  // Count different types of datasets
  const newsDatasets = projectFiles.filter(f => f.name.toLowerCase().includes('news')).length
  const reportDatasets = projectFiles.filter(f => f.name.toLowerCase().includes('report')).length
  const projectDatasets = projectFiles.filter(f =>
    f.name.toLowerCase().includes('project') ||
    f.name.toLowerCase().includes('swiss')
  ).length

  return (
    <div className="bg-gray-900/50 rounded-lg p-4">
      <h4 className="text-sm font-medium text-gray-300 mb-3">📈 Project Datasets</h4>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-400">Project Files:</span>
          <span className="text-white ml-2 font-semibold">{projectFiles.length}</span>
        </div>
        <div>
          <span className="text-gray-400">Last Updated:</span>
          <span className="text-white ml-2 font-semibold">Live</span>
        </div>
        <div>
          <span className="text-gray-400">Total Size:</span>
          <span className="text-white ml-2 font-semibold">{totalSizeMB} MB</span>
        </div>
        <div>
          <span className="text-gray-400">Status:</span>
          <span className="text-green-400 ml-2 font-semibold">Synced</span>
        </div>
      </div>

      {/* Dataset breakdown */}
      <div className="mt-4 pt-3 border-t border-gray-700">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center">
            <div className="text-blue-400 font-semibold">{projectDatasets}</div>
            <div className="text-gray-400">Projects</div>
          </div>
          <div className="text-center">
            <div className="text-yellow-400 font-semibold">{newsDatasets}</div>
            <div className="text-gray-400">News</div>
          </div>
          <div className="text-center">
            <div className="text-green-400 font-semibold">{reportDatasets}</div>
            <div className="text-gray-400">Reports</div>
          </div>
        </div>
      </div>
    </div>
  )
}
