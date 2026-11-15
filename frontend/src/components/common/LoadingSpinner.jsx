function LoadingSpinner({
  size = 'md',
  color = 'text-[#166534]',
  label = '',
  className = '',
}) {
  const sizeStyles = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-10 h-10 border-3',
  }

  return (
    <div
      className={`inline-flex items-center justify-center gap-2.5 ${className}`}
      role="status"
    >
      <div
        className={`animate-spin rounded-full border-current border-t-transparent ${
          sizeStyles[size] || sizeStyles.md
        } ${color}`}
      />
      {label && (
        <span className="text-sm font-medium text-[#64748b]">{label}</span>
      )}
      <span className="sr-only">Loading</span>
    </div>
  )
}

export default LoadingSpinner
