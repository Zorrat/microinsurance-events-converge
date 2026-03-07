import styles from "@/app/components/workflow/workflow-ui.module.css";

type ExplanationBoxProps = {
  label: string;
  title: string;
  body: string;
  checks: string[];
};

export function ExplanationBox({ label, title, body, checks }: ExplanationBoxProps) {
  return (
    <div className={styles.explanationBox}>
      <p className={styles.explanationLabel}>{label}</p>
      <h3 className={styles.explanationTitle}>{title}</h3>
      <p className={styles.explanationBody}>{body}</p>
      <ul className={styles.checkList}>
        {checks.map((check) => (
          <li key={check}>{check}</li>
        ))}
      </ul>
    </div>
  );
}
