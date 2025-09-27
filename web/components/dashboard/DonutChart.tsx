"use client"
import React from 'react'

type Slice = { label: string; value: number; color: string }

export default function DonutChart({ slices, size = 160, hole = 50, centerText }: { slices: Slice[]; size?: number; hole?: number; centerText?: string }) {
  const total = slices.reduce((a, b) => a + (b.value || 0), 0) || 1
  const cx = size / 2
  const cy = size / 2
  const r = (size - 10) / 2
  let angle = -Math.PI / 2

  const arcs = slices.map((s, i) => {
    const frac = (s.value || 0) / total
    const end = angle + frac * Math.PI * 2
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const largeArc = frac > 0.5 ? 1 : 0
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
    angle = end
    return <path key={`slice-${i}`} d={d} fill={s.color} opacity={0.9} />
  })

  // Calculate total percentage for center display
  const totalPercentage = Math.round(slices.reduce((sum, slice) => sum + ((slice.value / total) * 100), 0))

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Donut Chart */}
      <div className="flex-shrink-0">
        <svg width={size} height={size} className="block">
          {arcs}
          {/* hole */}
          <circle cx={cx} cy={cy} r={hole} fill="#0f1115" />
          {/* Center text */}
          <text x={cx} y={cy - 8} textAnchor="middle" fontSize={28} fontWeight="bold" fill="#e5e7eb">65%</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize={14} fill="#9ca3af">Label</text>
        </svg>
      </div>

      {/* Legend - Single Column */}
      <div className="w-full space-y-3">
        {slices.slice(0, 6).map((slice, i) => (
          <div key={`legend-${i}`} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="text-sm text-gray-300">{slice.label}</span>
            </div>
            <span className="text-lg font-semibold text-white">
              {((slice.value / total) * 100).toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

