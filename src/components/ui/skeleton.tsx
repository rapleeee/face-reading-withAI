import { cn } from "@/lib/utils";

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800/80",
        className,
      )}
      {...props}
    />
  );
}
