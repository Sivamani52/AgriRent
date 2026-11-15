import { Tractor } from 'lucide-react'

function EmptyState({
  icon: Icon = Tractor,
  title = 'No Items Found',
  description = 'There are no records to display at this moment.',
  action = null,
  className = '',
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 sm:p-12 text-center rounded-3xl border border-dashed border-[#e2e8f0] bg-white ${className}`}
    >
      <div className="w-14 h-14 rounded-2xl bg-slate-100 text-[#64748b] flex items-center justify-center mb-4">
        <Icon className="w-7 h-7" aria-hidden="true" />
      </div>

      <h3 className="text-lg font-bold text-[#1e293b] mb-1.5">{title}</h3>
      <p className="text-sm text-[#64748b] max-w-md mb-6 leading-relaxed">
        {description}
      </p>

      {action && <div>{action}</div>}
    </div>
  )
}

export default EmptyState
