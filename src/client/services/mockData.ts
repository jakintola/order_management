// Mock data for testing the dashboard
export const mockOrders = [
  {
    id: '1',
    orderNumber: 'ORD001',
    status: 'PENDING',
    totalAmount: 150.00,
    paymentMethod: 'CASH_ON_DELIVERY',
    paymentStatus: 'PENDING',
    fraudScore: 0.8,
    customer: {
      name: 'John Doe',
      phone: '+1234567890',
    },
    deliveries: [],
  },
  {
    id: '2',
    orderNumber: 'ORD002',
    status: 'IN_DELIVERY',
    totalAmount: 75.50,
    paymentMethod: 'CASH_ON_DELIVERY',
    paymentStatus: 'PENDING',
    fraudScore: 0.2,
    customer: {
      name: 'Jane Smith',
      phone: '+1987654321',
    },
    deliveries: [
      {
        id: 'DEL001',
        status: 'IN_PROGRESS',
        agent: {
          name: 'Test Agent 1',
          phone: '+1111111111',
        },
        currentLocation: {
          latitude: 40.7128,
          longitude: -74.0060,
        },
      },
    ],
  },
];

export const mockAgents = [
  {
    id: '1',
    name: 'Test Agent 1',
    phone: '+1111111111',
    isAvailable: true,
    lastKnownLocation: {
      latitude: 40.7128,
      longitude: -74.0060,
    },
    currentDeliveries: 2,
    maxWorkload: 5,
    successRate: 0.95,
    totalDeliveries: 150,
    remittanceRating: 0.98,
  },
  {
    id: '2',
    name: 'Test Agent 2',
    phone: '+2222222222',
    isAvailable: true,
    lastKnownLocation: {
      latitude: 40.7589,
      longitude: -73.9851,
    },
    currentDeliveries: 4,
    maxWorkload: 5,
    successRate: 0.85,
    totalDeliveries: 120,
    remittanceRating: 0.75,
  },
];

export const mockFraudAlerts = [
  {
    id: '1',
    type: 'HIGH_VALUE_FIRST_ORDER',
    severity: 0.8,
    timestamp: new Date().toISOString(),
    status: 'PENDING',
    details: {
      orderId: '1',
      orderNumber: 'ORD001',
      description: 'High-value first order from new customer',
      evidence: {
        orderAmount: 150.00,
        customerHistory: 'No previous orders',
      },
    },
  },
  {
    id: '2',
    type: 'SUSPICIOUS_DELIVERY_PATTERN',
    severity: 0.6,
    timestamp: new Date().toISOString(),
    status: 'RESOLVED',
    details: {
      orderId: '2',
      orderNumber: 'ORD002',
      agentId: '1',
      agentName: 'Test Agent 1',
      description: 'Multiple delivery attempts at unusual hours',
      evidence: {
        attempts: [
          { time: '23:45', status: 'FAILED' },
          { time: '00:15', status: 'FAILED' },
        ],
      },
    },
  },
];

export const mockRemittanceIssues = [
  {
    id: '1',
    deliveryId: 'DEL001',
    orderNumber: 'ORD001',
    agentName: 'Test Agent 1',
    expectedAmount: 150.00,
    actualAmount: 130.00,
    status: 'PENDING',
    timestamp: new Date().toISOString(),
  },
  {
    id: '2',
    deliveryId: 'DEL002',
    orderNumber: 'ORD002',
    agentName: 'Test Agent 2',
    expectedAmount: 75.50,
    actualAmount: 75.50,
    status: 'RESOLVED',
    timestamp: new Date().toISOString(),
  },
]; 