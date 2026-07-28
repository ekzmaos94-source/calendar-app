import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { colors, radius } from '../../utils/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 20,
          height: 68,
          paddingTop: 10,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.6)',
          backgroundColor: colors.cardBackgroundTranslucent,
          // Android에서 elevation(그림자) + 반투명 배경을 같이 쓰면 그림자를 그리기 위한
          // 불투명 배경판이 각진 흰 박스로 비치는 문제가 있어, 그림자 대신 밝은 테두리로 대체한다.
          elevation: 0,
          shadowOpacity: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '캘린더',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="stocks"
        options={{
          title: '주식',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trending-up" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
