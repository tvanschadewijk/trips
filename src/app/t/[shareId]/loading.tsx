export default function LoadingTripPage() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#F4EDE2',
        display: 'flex',
        justifyContent: 'center',
        padding: '0 16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          minHeight: '100dvh',
          position: 'relative',
          overflow: 'hidden',
          background: '#1A1410',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(251,247,241,0.06) 0%, rgba(251,247,241,0.02) 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(26,20,16,0.78) 0%, rgba(26,20,16,0.34) 45%, rgba(26,20,16,0.12) 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 56,
            background: 'rgba(26,20,16,0.2)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 24,
            right: 24,
            bottom: 40,
            display: 'grid',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 108,
              height: 28,
              borderRadius: 999,
              background: 'rgba(251,247,241,0.18)',
            }}
          />
          <div
            style={{
              width: '72%',
              height: 48,
              borderRadius: 4,
              background: 'rgba(251,247,241,0.2)',
            }}
          />
          <div
            style={{
              width: '56%',
              height: 18,
              borderRadius: 4,
              background: 'rgba(251,247,241,0.14)',
            }}
          />
          <div
            style={{
              width: '100%',
              height: 72,
              borderRadius: 4,
              background: 'rgba(251,247,241,0.12)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
