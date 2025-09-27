import React from 'react'

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-800 rounded ${className}`} />
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  )
}

