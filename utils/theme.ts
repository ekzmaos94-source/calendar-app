// 토스 스타일 참고: 연한 회색 배경 위에 흰 카드, 굵은 타이포, 넉넉한 여백, 알약형 배지.
export const colors = {
  pageBackground: '#F2F4F6',
  cardBackground: '#FFFFFF',
  cardBackgroundTranslucent: 'rgba(255, 255, 255, 0.75)',
  textPrimary: '#191F28',
  textSecondary: '#8B95A1',
  textTertiary: '#B0B8C1',
  accent: '#3182F6',
  accentSoft: '#EFF6FF',
  up: '#F04452',
  upSoft: '#FFF0F1',
  down: '#3182F6',
  downSoft: '#EFF6FF',
  divider: '#F2F4F6',
} as const;

export const radius = {
  card: 20,
  pill: 999,
  button: 14,
} as const;

export const cardShadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.04,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;
