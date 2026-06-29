import { Icon } from "@iconify/react"
import { cn } from "@/utils/styles/utils"

interface StarRatingProps {
  value: 1 | 2 | 3 | 4 | 5
  onChange?: (value: 1 | 2 | 3 | 4 | 5) => void
  size?: "sm" | "md" | "lg"
  readonly?: boolean
}

const sizeMap = {
  sm: "size-3",
  md: "size-4",
  lg: "size-6",
}

export function StarRating({ value, onChange, size = "md", readonly = false }: StarRatingProps) {
  return (
    <div className="inline-flex items-center gap-0.5">
      {([1, 2, 3, 4, 5] as const).map((star) => {
        const filled = star <= value
        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            onClick={() => onChange?.(star)}
            className={cn(
              "transition-colors",
              readonly ? "cursor-default" : "cursor-pointer hover:scale-110",
              filled ? "text-yellow-500" : "text-muted-foreground/30",
            )}
            title={`${star} 星`}
          >
            <Icon
              icon={filled ? "tabler:star-filled" : "tabler:star"}
              className={cn(sizeMap[size])}
            />
          </button>
        )
      })}
    </div>
  )
}
