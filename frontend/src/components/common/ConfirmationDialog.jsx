import { AlertTriangle, CheckCircle, HelpCircle } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'

function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title = 'Please Confirm',
  message = 'Are you sure you want to proceed with this action?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  isLoading = false,
}) {
  const iconConfig = {
    danger: {
      Icon: AlertTriangle,
      bg: 'bg-red-100',
      color: 'text-[#dc2626]',
      buttonVariant: 'danger',
    },
    primary: {
      Icon: CheckCircle,
      bg: 'bg-green-100',
      color: 'text-[#166534]',
      buttonVariant: 'primary',
    },
    neutral: {
      Icon: HelpCircle,
      bg: 'bg-slate-100',
      color: 'text-[#64748b]',
      buttonVariant: 'primary',
    },
  }

  const current = iconConfig[variant] || iconConfig.primary
  const IconComponent = current.Icon

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            size="md"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
          <Button
            variant={current.buttonVariant}
            size="md"
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-11 h-11 rounded-2xl ${current.bg} ${current.color} flex items-center justify-center shrink-0 mt-0.5`}
        >
          <IconComponent className="w-6 h-6" aria-hidden="true" />
        </div>
        <p className="text-sm text-[#64748b] leading-relaxed pt-1">
          {message}
        </p>
      </div>
    </Modal>
  )
}

export default ConfirmationDialog
