import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  fetchMovers,
  loadCachedMovers,
  Mover,
  MoversBundle,
  MoversData,
  MoversSession,
} from '../../utils/movers';

const SESSION_LABEL: Record<MoversSession, string> = {
  open: '장 초반',
  close: '마감',
};

const SESSION_ORDER: MoversSession[] = ['open', 'close'];

function formatTradingDate(dateString: string) {
  const [year, month, day] = dateString.split('-').map((part) => parseInt(part, 10));
  return new Date(year, month - 1, day).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function MoverRow({ item }: { item: Mover }) {
  const isUp = item.changePercent >= 0;
  const onPressNews = () => {
    if (item.news?.url) Linking.openURL(item.news.url);
  };

  return (
    <View style={styles.moverRow}>
      <View style={styles.moverHeaderRow}>
        <View style={styles.moverTitleGroup}>
          <Text style={styles.moverSymbol}>{item.symbol}</Text>
          <Text style={styles.moverName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
        <Text style={[styles.moverChange, isUp ? styles.changeUp : styles.changeDown]}>
          {isUp ? '+' : ''}
          {item.changePercent.toFixed(2)}%
        </Text>
      </View>
      {item.news ? (
        <Pressable onPress={onPressNews} hitSlop={4}>
          <Text style={styles.newsHeadline} numberOfLines={2}>
            {item.news.headlineKo ?? item.news.headline}
          </Text>
          <Text style={styles.newsSource}>{item.news.source}</Text>
        </Pressable>
      ) : (
        <Text style={styles.newsMissing}>관련 뉴스를 찾지 못했어요.</Text>
      )}
    </View>
  );
}

function MoversSection({ data }: { data: MoversData }) {
  return (
    <View style={styles.section}>
      <Text style={styles.dateLabel}>{formatTradingDate(data.tradingDate)} 기준</Text>
      {data.movers.map((item) => (
        <MoverRow key={item.symbol} item={item} />
      ))}
    </View>
  );
}

function SessionTabs({
  bundle,
  selected,
  onSelect,
}: {
  bundle: MoversBundle;
  selected: MoversSession;
  onSelect: (session: MoversSession) => void;
}) {
  return (
    <View style={styles.segmentRow}>
      {SESSION_ORDER.map((session) => {
        const isDisabled = bundle[session].movers.length === 0;
        const isSelected = selected === session;
        return (
          <Pressable
            key={session}
            onPress={() => onSelect(session)}
            disabled={isDisabled}
            style={[styles.segmentButton, isSelected && styles.segmentButtonSelected]}
          >
            <Text
              style={[
                styles.segmentButtonText,
                isSelected && styles.segmentButtonTextSelected,
                isDisabled && styles.segmentButtonTextDisabled,
              ]}
            >
              {SESSION_LABEL[session]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function StocksScreen() {
  const [bundle, setBundle] = useState<MoversBundle | null>(null);
  const [selectedSession, setSelectedSession] = useState<MoversSession>('close');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 새로고침 중에도 화면에 남겨둘 데이터가 있는지는 bundle로 판단하고,
  // 앱을 처음 켰을 때(캐시도 없는 상태)만 전체 화면 스피너를 보여준다.
  const isInitialLoading = isRefreshing && !bundle;

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      setBundle(await fetchMovers());
    } catch {
      setError('데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const cached = await loadCachedMovers();
      if (cached) setBundle(cached);
      refresh();
    })();
  }, [refresh]);

  // 선택된 탭에 데이터가 없는데 다른 탭엔 있으면(초기 진입, 새로고침으로 클리어됨 등)
  // 빈 탭을 계속 보고 있지 않도록 데이터가 있는 쪽으로 옮겨준다.
  useEffect(() => {
    if (!bundle) return;
    const other: MoversSession = selectedSession === 'open' ? 'close' : 'open';
    if (bundle[selectedSession].movers.length === 0 && bundle[other].movers.length > 0) {
      setSelectedSession(other);
    }
  }, [bundle, selectedSession]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>주식</Text>
        <Pressable onPress={refresh} disabled={isRefreshing} hitSlop={8}>
          {isRefreshing ? (
            <ActivityIndicator size="small" color="#6b7280" />
          ) : (
            <Ionicons name="refresh" size={20} color="#6b7280" />
          )}
        </Pressable>
      </View>

      {isInitialLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#2563eb" />
        </View>
      ) : error && !bundle ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !bundle || (bundle.open.movers.length === 0 && bundle.close.movers.length === 0) ? (
        <View style={styles.centerState}>
          <Ionicons name="trending-up-outline" size={40} color="#d1d5db" />
          <Text style={styles.placeholderSubtitle}>
            S&P 500 종목 중 시가 대비 {bundle?.close.thresholdPercent ?? 5}% 이상 변동한 종목이
            없어요.
          </Text>
        </View>
      ) : (
        <>
          <SessionTabs bundle={bundle} selected={selectedSession} onSelect={setSelectedSession} />
          <ScrollView contentContainerStyle={styles.list}>
            <MoversSection data={bundle[selectedSession]} />
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
  },
  header: {
    fontSize: 19,
    fontWeight: '700',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  placeholderSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 19,
  },
  errorText: {
    fontSize: 14,
    color: '#dc2626',
    textAlign: 'center',
  },
  segmentRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 4,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 3,
    gap: 3,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  segmentButtonSelected: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  segmentButtonTextSelected: {
    color: '#2563eb',
  },
  segmentButtonTextDisabled: {
    color: '#d1d5db',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  section: {
    marginBottom: 20,
  },
  dateLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
    marginTop: 4,
    marginBottom: 8,
  },
  moverRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    gap: 4,
  },
  moverHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moverTitleGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flexShrink: 1,
  },
  moverSymbol: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  moverName: {
    fontSize: 12,
    color: '#6b7280',
    flexShrink: 1,
  },
  moverChange: {
    fontSize: 15,
    fontWeight: '700',
  },
  changeUp: {
    color: '#dc2626',
  },
  changeDown: {
    color: '#2563eb',
  },
  newsHeadline: {
    fontSize: 13,
    color: '#111827',
    lineHeight: 18,
  },
  newsSource: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  newsMissing: {
    fontSize: 12,
    color: '#9ca3af',
  },
});
