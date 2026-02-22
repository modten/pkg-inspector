import type { LoadingStep } from "../types";

interface LoadingProps {
  steps: LoadingStep[];
  message?: string;
}

export function Loading({ steps, message }: LoadingProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-6">
      {/* Spinner */}
      <div className="w-10 h-10 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin" />

      {/* Optional message */}
      {message && (
        <p className="text-gray-400 text-sm">{message}</p>
      )}

      {/* Step indicators */}
      {steps.length > 0 && (
        <div className="flex flex-col gap-2 text-sm">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              {step.done ? (
                <span className="text-green-400">&#10003;</span>
              ) : (
                <span className="text-yellow-400 animate-pulse">&#9679;</span>
              )}
              <span className={step.done ? "text-gray-500" : "text-gray-300"}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
