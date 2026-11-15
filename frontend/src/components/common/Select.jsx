import { ChevronDown } from 'lucide-react'

function Select({
  label,
  id,
  name,
  value,
  onChange,
  options = [],
  placeholder = 'Select an option',
  required = false,
  disabled = false,
  error,
  helperText,
  className = '',
  ...props
}) {
  const selectId = id || name

  return (
    <div className="w-full text-left">
      {label && (
        <label
          htmlFor={selectId}
          className="block text-xs sm:text-sm font-semibold text-[#1e293b] mb-1.5"
        >
          {label}
          {required && <span className="text-[#dc2626] ml-1">*</span>}
        </label>
      )}

      <div className="relative rounded-xl w-full">
        <select
          id={selectId}
          name={name}
          value={value}
          onChange={onChange}
          disabled={disabled}
          required={required}
          className={`block w-full min-h-[44px] appearance-none rounded-xl border bg-white py-2.5 pl-3.5 pr-10 text-base sm:text-sm text-[#1e293b] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:bg-slate-100 disabled:text-[#64748b] disabled:cursor-not-allowed ${
            error
              ? 'border-[#dc2626] focus:border-[#dc2626] focus:ring-red-200'
              : 'border-[#e2e8f0] hover:border-slate-300 focus:border-[#166534] focus:ring-green-100'
          } ${className}`}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option, index) => {
            const val = typeof option === 'object' ? option.value : option
            const lbl = typeof option === 'object' ? option.label : option
            return (
              <option key={index} value={val}>
                {lbl}
              </option>
            )
          })}
        </select>

        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-[#64748b]">
          <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
        </div>
      </div>

      {error ? (
        <p className="mt-1.5 text-xs text-[#dc2626] font-medium leading-normal">{error}</p>
      ) : helperText ? (
        <p className="mt-1.5 text-xs text-[#64748b] leading-normal">{helperText}</p>
      ) : null}
    </div>
  )
}

export default Select
