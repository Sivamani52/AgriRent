import { Search, X } from 'lucide-react'
import Button from './Button'

function SearchBar({
  value = '',
  onChange,
  onSearch,
  placeholder = 'Search tractors, harvesters, farm tools...',
  className = '',
  buttonText = 'Search',
  ...props
}) {
  const handleSubmit = (e) => {
    e.preventDefault()
    if (onSearch) {
      onSearch(value)
    }
  }

  const handleClear = () => {
    if (onChange) {
      onChange({ target: { value: '' } })
    }
    if (onSearch) {
      onSearch('')
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`relative flex items-center w-full max-w-2xl bg-white rounded-2xl border border-[#e2e8f0] p-1.5 shadow-xs hover:border-slate-300 focus-within:border-[#166534] focus-within:ring-2 focus-within:ring-green-100 transition-all ${className}`}
      {...props}
    >
      <div className="pl-2.5 sm:pl-3 pr-2 text-[#64748b] shrink-0">
        <Search className="w-4 h-4 sm:w-5 sm:h-5 text-[#166534]" aria-hidden="true" />
      </div>

      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full flex-1 min-w-0 bg-transparent py-2 text-sm text-[#1e293b] placeholder:text-[#94a3b8] focus:outline-none"
      />

      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="p-1 mr-1 text-[#64748b] hover:text-[#1e293b] rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          aria-label="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <Button
        type="submit"
        variant="primary"
        size="sm"
        className="shrink-0 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-semibold"
      >
        {buttonText}
      </Button>
    </form>
  )
}

export default SearchBar
