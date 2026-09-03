/** 문의를 고르지 않았을 때 대화·상세 자리에 그리는 빈 상태. */
export default function InboxEmptyState() {
  return (
    <section className="flex-1 min-w-0 h-full bg-ground flex items-center justify-center" aria-label="대화">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-panel border border-line flex items-center justify-center text-muted">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4h16v12H8l-4 4z" />
          </svg>
        </div>
        <p className="text-sm text-muted">목록에서 문의를 선택하세요</p>
      </div>
    </section>
  );
}
