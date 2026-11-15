function Skeleton({
  variant = 'rectangular',
  className = '',
  ...props
}) {
  const variantStyles = {
    text: 'h-4 w-full rounded-md',
    rectangular: 'w-full rounded-2xl',
    circular: 'rounded-full',
  }

  return (
    <div
      className={`animate-pulse bg-slate-200/80 ${
        variantStyles[variant] || variantStyles.rectangular
      } ${className}`}
      aria-hidden="true"
      {...props}
    />
  )
}

export default Skeleton
