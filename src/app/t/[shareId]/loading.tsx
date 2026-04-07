export default function LoadingTripPage() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#2C2C2C',
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
          background: '#2C2C2C',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.34) 45%, rgba(0,0,0,0.12) 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 56,
            background: 'rgba(44,44,44,0.2)',
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
              background: 'rgba(255,255,255,0.16)',
            }}
          />
          <div
            style={{
              width: '72%',
              height: 48,
              borderRadius: 20,
              background: 'rgba(255,255,255,0.18)',
            }}
          />
          <div
            style={{
              width: '56%',
              height: 18,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.12)',
            }}
          />
          <div
            style={{
              width: '100%',
              height: 72,
              borderRadius: 18,
              background: 'rgba(255,255,255,0.1)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
