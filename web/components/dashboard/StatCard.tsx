import React from 'react'

export default function StatCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="stat">
      <div className="h-8 w-8 rounded bg-gray-700 flex items-center justify-center text-xs">{icon || '•'}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}

