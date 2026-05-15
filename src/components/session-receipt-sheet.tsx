import { useState, useEffect } from "react";
import { Copy, X } from "lucide-react";
import { getSessionExportData } from "@/lib/session-export";
import { formatSessionReceipt } from "@/lib/receipt-formatter";

interface Props {
  workoutId: string;
  onClose: () => void;
}

export function SessionReceiptSheet({ workoutId, onClose }: Props) {
  const [visible, setVisible] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    getSessionExportData(workoutId).then((data) => {
      if (data) setReceipt(formatSessionReceipt(data));
      setLoading(false);
    });
  }, [workoutId]);

  function handleCopy() {
    if (!receipt) return;
    navigator.clipboard.writeText(receipt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-background border-t border-border shadow-xl transition-transform duration-300 ease-out"
        style={{
          maxHeight: "88vh",
          transform: visible ? "translateY(0)" : "translateY(100%)",
        }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted" />

        <div className="flex items-center justify-between gap-2 px-4 py-3 shrink-0 border-b border-border">
          <span className="font-semibold text-base">Session Receipt</span>
          <div className="flex items-center gap-2">
            {receipt && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-sm hover:bg-muted/70"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : receipt ? (
            <pre className="overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed">
              {receipt}
            </pre>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load session data.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
