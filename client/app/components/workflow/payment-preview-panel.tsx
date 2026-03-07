import styles from "@/app/components/workflow/workflow-ui.module.css";

type PaymentPreviewPanelProps = {
  endpointLabel: string;
  amountLabel: string;
  networkLabel: string;
  receiverLabel: string;
  assetLabel?: string;
  descriptionLabel?: string;
  errorLabel?: string;
  onRefresh: () => void;
  loading: boolean;
  disabled?: boolean;
};

export function PaymentPreviewPanel({
  endpointLabel,
  amountLabel,
  networkLabel,
  receiverLabel,
  assetLabel,
  descriptionLabel,
  errorLabel,
  onRefresh,
  loading,
  disabled,
}: PaymentPreviewPanelProps) {
  return (
    <div className={styles.previewPanel}>
      <h3 className={styles.panelHeading}>MetaMask Payment Preview</h3>

      <div className={styles.chipRow}>
        <span className={styles.stageChip}>Endpoint: {endpointLabel}</span>
        <span className={styles.stageChip}>Amount: {amountLabel}</span>
        <span className={styles.stageChip}>Network: {networkLabel}</span>
      </div>

      <p className={styles.metaLine}>Receiver: {receiverLabel}</p>
      {assetLabel ? <p className={styles.metaLine}>Asset: {assetLabel}</p> : null}
      {descriptionLabel ? <p className={styles.metaLine}>Description: {descriptionLabel}</p> : null}
      {errorLabel ? <p className={styles.errorLine}>{errorLabel}</p> : null}

      <button type="button" className={`btn ${styles.actionButton}`} onClick={onRefresh} disabled={disabled || loading}>
        {loading ? "Loading payment preview..." : "Refresh Payment Preview"}
      </button>
    </div>
  );
}
