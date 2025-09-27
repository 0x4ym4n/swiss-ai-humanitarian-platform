'use client'
import React from 'react'
import { Skeleton } from '../ui/Skeleton'

interface NewsItem {
  id: string
  title: string
  summary: string
  date: string
  source: string
  url: string
  relevance: number
  category: string
  location: string[]
  urgency: 'low' | 'medium' | 'high' | 'critical'
}

interface NewsComponentProps {
  apiBase: string
}

export default function NewsComponent({ apiBase }: NewsComponentProps) {
  const [news, setNews] = React.useState<NewsItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string>('')
  const [filter, setFilter] = React.useState<'all' | 'urgent' | 'relevant'>('relevant')
  const [searchQuery, setSearchQuery] = React.useState('')

  const fetchNews = async () => {
    try {
      setLoading(true)
      setError('')

      // Query for relevant news based on current dashboard context
      const query = searchQuery || 'Sudan humanitarian projects SDC development aid'
      const response = await fetch(`${apiBase}/api/vectorstore/news/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          collection: 'reliefweb_news',
          top_k: 12,
          filter_category: filter === 'urgent' ? 'urgent' : undefined
        })
      })

      if (!response.ok) {
        throw new Error('Failed to fetch news')
      }

      const data = await response.json()
      setNews(data.news || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load news')
      console.error('News fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    fetchNews()
  }, [filter, apiBase])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchNews()
  }

  const calculateTimeRelevance = (dateString: string): number => {
    try {
      const date = new Date(dateString)
      const now = new Date()
      const daysDiff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

      // Time-based relevance score (0-1)
      if (daysDiff <= 1) return 1.0      // Within 24 hours
      if (daysDiff <= 7) return 0.9      // Within week
      if (daysDiff <= 30) return 0.8     // Within month
      if (daysDiff <= 90) return 0.6     // Within 3 months
      if (daysDiff <= 180) return 0.4    // Within 6 months
      if (daysDiff <= 365) return 0.3    // Within year
      if (daysDiff <= 730) return 0.2    // Within 2 years
      return 0.1                         // Older
    } catch {
      return 0.1
    }
  }

  const filteredNews = React.useMemo(() => {
    let filtered = news.map(item => ({
      ...item,
      timeRelevance: calculateTimeRelevance(item.date),
      combinedScore: item.relevance * 0.7 + calculateTimeRelevance(item.date) * 0.3 // 70% content relevance, 30% time relevance
    }))

    if (filter === 'urgent') {
      filtered = filtered.filter(item => item.urgency === 'high' || item.urgency === 'critical')
    } else if (filter === 'relevant') {
      // Sort by combined relevance and time score
      filtered = filtered
        .filter(item => item.relevance > 0.3 || item.timeRelevance > 0.7) // Include highly recent items even if lower content relevance
        .sort((a, b) => b.combinedScore - a.combinedScore)
    }

    return filtered.slice(0, 12) // Show top 12 items
  }, [news, filter])

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30'
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      default: return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    }
  }

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    } catch {
      return dateString
    }
  }

  const getTimeIndicator = (dateString: string) => {
    try {
      const date = new Date(dateString)
      const now = new Date()
      const daysDiff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

      if (daysDiff === 0) return { text: 'Today', color: 'text-green-400', icon: '🔥' }
      if (daysDiff === 1) return { text: 'Yesterday', color: 'text-green-400', icon: '⚡' }
      if (daysDiff <= 7) return { text: `${daysDiff}d ago`, color: 'text-blue-400', icon: '🆕' }
      if (daysDiff <= 30) return { text: `${Math.ceil(daysDiff/7)}w ago`, color: 'text-yellow-400', icon: '📅' }
      if (daysDiff <= 90) return { text: `${Math.ceil(daysDiff/30)}mo ago`, color: 'text-orange-400', icon: '📅' }
      return { text: `${Math.ceil(daysDiff/30)}mo ago`, color: 'text-gray-500', icon: '📅' }
    } catch {
      return { text: 'Unknown', color: 'text-gray-500', icon: '📅' }
    }
  }

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength).trim() + '...'
  }

  return (
    <div className="card h-full">
      <div className="card-header">
        <div className="card-title">📰 Related News & Updates</div>
        <div className="text-xs text-gray-400">ReliefWeb humanitarian news</div>
      </div>

      <div className="card-body">
        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="bg-gray-900/30 rounded-lg p-4">
            <form onSubmit={handleSearch} className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Search news... (e.g., Sudan, humanitarian, emergency)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    filter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  All News
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('relevant')}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    filter === 'relevant'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Most Relevant
                </button>
                <button
                  type="button"
                  onClick={() => setFilter('urgent')}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    filter === 'urgent'
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  🚨 Urgent
                </button>
              </div>
            </form>
          </div>

          {/* Error State */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">{error}</span>
              </div>
              <button
                onClick={fetchNews}
                className="mt-2 px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* News List */}
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {loading ? (
              // Loading skeleton
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-gray-900/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))
            ) : filteredNews.length === 0 ? (
              // Empty state
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                </div>
                <p className="text-gray-400">No news found</p>
                <p className="text-xs text-gray-500 mt-1">Try adjusting your search or filter</p>
              </div>
            ) : (
              // News items
              filteredNews.map((item) => (
                <div
                  key={item.id}
                  className="bg-gray-900/50 rounded-lg p-4 hover:bg-gray-800/50 transition-colors border border-gray-800 hover:border-gray-700"
                >
                  <div className="space-y-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="text-sm font-medium text-white leading-tight">
                        {truncateText(item.title, 100)}
                      </h4>
                      <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getUrgencyColor(item.urgency)}`}>
                        {item.urgency}
                      </div>
                    </div>

                    {/* Summary */}
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {item.summary && item.summary !== 'No summary available'
                        ? truncateText(item.summary, 180)
                        : 'Click to read full article on ReliefWeb for more details about this humanitarian situation in Sudan.'
                      }
                    </p>

                    {/* Metadata */}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400">
                          📅 {formatDate(item.date)}
                        </span>
                        {(() => {
                          const timeIndicator = getTimeIndicator(item.date)
                          return (
                            <span className={`${timeIndicator.color} font-medium`}>
                              {timeIndicator.icon} {timeIndicator.text}
                            </span>
                          )
                        })()}
                        {item.location && item.location.length > 0 && (
                          <span className="text-gray-400">
                            📍 {item.location.slice(0, 2).join(', ')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <span className={`text-xs font-medium ${
                            item.relevance > 0.8 ? 'text-green-400' :
                            item.relevance > 0.6 ? 'text-blue-400' :
                            item.relevance > 0.4 ? 'text-yellow-400' :
                            'text-gray-500'
                          }`}>
                            {Math.round(item.relevance * 100)}%
                          </span>
                          {(() => {
                            const timeRelevance = item.timeRelevance || calculateTimeRelevance(item.date)
                            const combinedScore = item.combinedScore || (item.relevance * 0.7 + timeRelevance * 0.3)
                            return (
                              <span className={`text-xs px-1 py-0.5 rounded ${
                                combinedScore > 0.8 ? 'bg-green-500/20 text-green-400' :
                                combinedScore > 0.6 ? 'bg-blue-500/20 text-blue-400' :
                                combinedScore > 0.4 ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-gray-500/20 text-gray-400'
                              }`}>
                                {Math.round(combinedScore * 100)}
                              </span>
                            )
                          })()}
                        </div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {!loading && filteredNews.length > 0 && (
            <div className="flex items-center justify-between pt-3 border-t border-gray-700">
              <div className="text-xs text-gray-400">
                Showing {filteredNews.length} of {news.length} articles
              </div>
              <button
                onClick={fetchNews}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs transition-colors flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}