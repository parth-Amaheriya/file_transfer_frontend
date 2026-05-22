import { cn } from "@/lib/utils";

type LoaderSize = "sm" | "md" | "lg";

interface LoaderProps {
  className?: string;
  label?: string;
  size?: LoaderSize;
}

const Loader = ({ className, label, size = "md" }: LoaderProps) => {
  const ariaLabel = label || "Loading";

  return (
    <div className={cn("space-loader", className)} data-size={size} role="status" aria-label={ariaLabel}>
      <div className="space-loader__stage" aria-hidden="true">
        <div className="space-loader__ship">
          <span>
            <span />
            <span />
            <span />
            <span />
          </span>
          <div className="space-loader__base">
            <span />
            <div className="space-loader__face" />
          </div>
        </div>
        <div className="space-loader__longfazers">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
};

export default Loader;