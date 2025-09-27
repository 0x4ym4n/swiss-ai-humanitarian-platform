"use client"
import React from 'react'

type Series = { name: string; values: number[]; color: string }

export default function BarChart({ labels, series, height = 300, labelTruncate = 12, labelAngle = -35 }: { labels: string[]; series: Series[]; height?: number; labelTruncate?: number; labelAngle?: number }) {
  const max = Math.max(1, ...series.flatMap(s => s.values))
  const barWidth = 28
  const gap = 16
  const groupWidth = barWidth * series.length + gap
  const width = Math.max(400, labels.length * groupWidth + 80)
  const bottomPad = Math.max(100, labelTruncate > 15 ? 120 : 100)

  // Format large numbers
  const formatValue = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K`
    return value.toString()
  }

  // Create better label truncation for partner names
  const truncateLabel = (label: string, maxLength: number) => {
    if (label.length <= maxLength) return label

    // Special handling for partner organization names
    const words = label.split(' ')
    if (words.length > 1) {
      // Prioritize important words (org names, locations)
      const importantWords = ['United', 'Nations', 'International', 'Organization', 'Foundation', 'Agency', 'Council', 'Government', 'Ministry', 'Department']
      const priorityWords = words.filter(word =>
        importantWords.some(imp => word.includes(imp)) ||
        word.length > 3 ||
        word.includes('.')
      )

      if (priorityWords.length > 0) {
        let result = priorityWords[0]
        for (let i = 1; i < priorityWords.length; i++) {
          if ((result + ' ' + priorityWords[i]).length <= maxLength - 1) {
            result += ' ' + priorityWords[i]
          } else {
            break
          }
        }
        return result + '…'
      }

      // Fallback to first few words
      let result = words[0]
      for (let i = 1; i < words.length; i++) {
        if ((result + ' ' + words[i]).length <= maxLength - 1) {
          result += ' ' + words[i]
        } else {
          break
        }
      }
      return result.length < label.length ? result + '…' : result
    }
    return label.slice(0, maxLength - 1) + '…'
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg width={width} height={height} className="block">
        {/* Grid lines for better readability */}
        <defs>
          <pattern id="grid" width="1" height="20" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 20" fill="none" stroke="#374151" strokeWidth="0.5" opacity="0.3"/>
          </pattern>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const y = height - bottomPad - (height - bottomPad - 30) * ratio
          return (
            <g key={i}>
              <line x1={40} y1={y} x2={width - 20} y2={y} stroke="#374151" strokeWidth="0.5" opacity="0.2" />
              <text x={35} y={y + 4} fontSize={10} fill="#6b7280" textAnchor="end">
                {formatValue(Math.round(max * ratio))}
              </text>
            </g>
          )
        })}

        {/* Main axis */}
        <line x1={40} y1={height - bottomPad} x2={width - 20} y2={height - bottomPad} stroke="#4b5563" strokeWidth="1.5" />

        {/* Labels */}
        {labels.map((lab, i) => {
          const x = 40 + i * groupWidth + (groupWidth - gap) / 2
          const y = height - 15
          const text = truncateLabel(lab, labelTruncate)
          return (
            <g key={i}>
              <g transform={`translate(${x},${y}) rotate(${labelAngle})`}>
                <text textAnchor="end" fontSize={11} fill="#d1d5db" fontWeight="500">
                  {text}
                </text>
              </g>
              {/* Tooltip on hover - show full label */}
              {lab.length > labelTruncate && (
                <title>{lab}</title>
              )}
            </g>
          )
        })}

        {/* Bars */}
        {series.map((s, si) => (
          <g key={si}>
            {s.values.map((v, i) => {
              const h = Math.max(4, Math.round((v / max) * (height - bottomPad - 40)))
              const x = 40 + i * groupWidth + si * barWidth
              const y = height - bottomPad - h
              return (
                <g key={i}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth - 2}
                    height={h}
                    rx={4}
                    fill={s.color}
                    opacity={0.85}
                    className="hover:opacity-100 transition-opacity cursor-pointer"
                  />
                  {/* Value labels on top of bars for important data */}
                  {h > 30 && (
                    <text
                      x={x + (barWidth - 2) / 2}
                      y={y - 5}
                      fontSize={10}
                      fill="#e5e7eb"
                      textAnchor="middle"
                      className="pointer-events-none"
                    >
                      {formatValue(v)}
                    </text>
                  )}
                  {/* Tooltip */}
                  <title>{`${labels[i]}: ${formatValue(v)}`}</title>
                </g>
              )
            })}
          </g>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4 text-sm text-gray-300">
        {series.map(s => (
          <div key={s.name} className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 rounded" style={{ background: s.color }}></span>
            <span>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
