import React, { useState, useEffect } from 'react';
import {
  Table,
  Card,
  Row,
  Col,
  Statistic,
  Alert,
  Space,
  Button,
  Modal,
  Timeline,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  WarningOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import axios from 'axios';

interface FraudAlert {
  id: string;
  type: string;
  severity: number;
  timestamp: string;
  status: 'PENDING' | 'RESOLVED' | 'CONFIRMED_FRAUD';
  details: {
    orderId: string;
    orderNumber: string;
    agentId?: string;
    agentName?: string;
    description: string;
    evidence: any;
  };
}

interface RemittanceIssue {
  id: string;
  deliveryId: string;
  orderNumber: string;
  agentName: string;
  expectedAmount: number;
  actualAmount: number;
  status: 'PENDING' | 'RESOLVED' | 'DISPUTED';
  timestamp: string;
}

const FraudPrevention: React.FC = () => {
  const [fraudAlerts, setFraudAlerts] = useState<FraudAlert[]>([]);
  const [remittanceIssues, setRemittanceIssues] = useState<RemittanceIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAlert, setSelectedAlert] = useState<FraudAlert | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [alertsResponse, remittanceResponse] = await Promise.all([
        axios.get('/api/fraud-alerts'),
        axios.get('/api/remittance-issues'),
      ]);
      setFraudAlerts(alertsResponse.data);
      setRemittanceIssues(remittanceResponse.data);
      setLoading(false);
    } catch (error) {
      message.error('Failed to fetch fraud prevention data');
      console.error('Error fetching data:', error);
    }
  };

  const handleAlertResolution = async (alertId: string, resolution: 'RESOLVED' | 'CONFIRMED_FRAUD') => {
    try {
      await axios.post(`/api/fraud-alerts/${alertId}/resolve`, { resolution });
      message.success('Alert resolution updated successfully');
      fetchData();
    } catch (error) {
      message.error('Failed to update alert resolution');
      console.error('Error updating resolution:', error);
    }
  };

  const handleRemittanceResolution = async (issueId: string, resolution: 'RESOLVED' | 'DISPUTED') => {
    try {
      await axios.post(`/api/remittance-issues/${issueId}/resolve`, { resolution });
      message.success('Remittance issue resolution updated successfully');
      fetchData();
    } catch (error) {
      message.error('Failed to update remittance resolution');
      console.error('Error updating resolution:', error);
    }
  };

  const getSeverityTag = (severity: number) => {
    let color = 'green';
    let text = 'Low';
    if (severity >= 0.7) {
      color = 'red';
      text = 'High';
    } else if (severity >= 0.4) {
      color = 'orange';
      text = 'Medium';
    }
    return (
      <Tooltip title={`Risk Score: ${(severity * 100).toFixed(1)}%`}>
        <Tag color={color}>{text}</Tag>
      </Tooltip>
    );
  };

  const alertColumns = [
    {
      title: 'Time',
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
    },
    {
      title: 'Severity',
      dataIndex: 'severity',
      key: 'severity',
      render: getSeverityTag,
    },
    {
      title: 'Order',
      dataIndex: ['details', 'orderNumber'],
      key: 'orderNumber',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const statusColors = {
          PENDING: 'warning',
          RESOLVED: 'success',
          CONFIRMED_FRAUD: 'error',
        };
        return <Tag color={statusColors[status as keyof typeof statusColors]}>{status}</Tag>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (text: string, record: FraudAlert) => (
        <Space>
          <Button
            type="link"
            onClick={() => {
              setSelectedAlert(record);
              setDetailsVisible(true);
            }}
          >
            Details
          </Button>
          {record.status === 'PENDING' && (
            <>
              <Button
                type="primary"
                onClick={() => handleAlertResolution(record.id, 'RESOLVED')}
              >
                Mark Resolved
              </Button>
              <Button
                danger
                onClick={() => handleAlertResolution(record.id, 'CONFIRMED_FRAUD')}
              >
                Confirm Fraud
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  const remittanceColumns = [
    {
      title: 'Time',
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: 'Order',
      dataIndex: 'orderNumber',
      key: 'orderNumber',
    },
    {
      title: 'Agent',
      dataIndex: 'agentName',
      key: 'agentName',
    },
    {
      title: 'Discrepancy',
      key: 'discrepancy',
      render: (text: string, record: RemittanceIssue) => (
        <Space direction="vertical">
          <span>Expected: ${record.expectedAmount.toFixed(2)}</span>
          <span>Actual: ${record.actualAmount.toFixed(2)}</span>
          <Tag color="red">
            Difference: ${Math.abs(record.expectedAmount - record.actualAmount).toFixed(2)}
          </Tag>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const statusColors = {
          PENDING: 'warning',
          RESOLVED: 'success',
          DISPUTED: 'error',
        };
        return <Tag color={statusColors[status as keyof typeof statusColors]}>{status}</Tag>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (text: string, record: RemittanceIssue) => (
        <Space>
          {record.status === 'PENDING' && (
            <>
              <Button
                type="primary"
                onClick={() => handleRemittanceResolution(record.id, 'RESOLVED')}
              >
                Mark Resolved
              </Button>
              <Button
                danger
                onClick={() => handleRemittanceResolution(record.id, 'DISPUTED')}
              >
                Mark Disputed
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  const renderAlertDetails = () => {
    if (!selectedAlert) return null;

    return (
      <Modal
        title={`Alert Details - ${selectedAlert.type}`}
        visible={detailsVisible}
        onCancel={() => setDetailsVisible(false)}
        footer={null}
        width={800}
      >
        <Timeline>
          <Timeline.Item>
            <p><strong>Time:</strong> {new Date(selectedAlert.timestamp).toLocaleString()}</p>
          </Timeline.Item>
          <Timeline.Item>
            <p><strong>Order Number:</strong> {selectedAlert.details.orderNumber}</p>
          </Timeline.Item>
          {selectedAlert.details.agentName && (
            <Timeline.Item>
              <p><strong>Agent:</strong> {selectedAlert.details.agentName}</p>
            </Timeline.Item>
          )}
          <Timeline.Item>
            <p><strong>Description:</strong> {selectedAlert.details.description}</p>
          </Timeline.Item>
          <Timeline.Item>
            <Card title="Evidence">
              <pre>{JSON.stringify(selectedAlert.details.evidence, null, 2)}</pre>
            </Card>
          </Timeline.Item>
        </Timeline>
      </Modal>
    );
  };

  return (
    <div>
      <h1>Fraud Prevention Dashboard</h1>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="Active Alerts"
              value={fraudAlerts.filter(a => a.status === 'PENDING').length}
              suffix={`/ ${fraudAlerts.length}`}
              valueStyle={{ color: '#cf1322' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Pending Remittance Issues"
              value={remittanceIssues.filter(r => r.status === 'PENDING').length}
              suffix={`/ ${remittanceIssues.length}`}
              valueStyle={{ color: '#faad14' }}
              prefix={<ExclamationCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Resolved Today"
              value={
                fraudAlerts.filter(
                  a =>
                    a.status === 'RESOLVED' &&
                    new Date(a.timestamp).toDateString() === new Date().toDateString()
                ).length
              }
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Confirmed Fraud Cases"
              value={fraudAlerts.filter(a => a.status === 'CONFIRMED_FRAUD').length}
              prefix={<CloseCircleOutlined />}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title="Fraud Alerts" style={{ marginBottom: 16 }}>
        <Table
          columns={alertColumns}
          dataSource={fraudAlerts}
          loading={loading}
          rowKey="id"
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Card title="Remittance Issues">
        <Table
          columns={remittanceColumns}
          dataSource={remittanceIssues}
          loading={loading}
          rowKey="id"
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {renderAlertDetails()}
    </div>
  );
};

export default FraudPrevention; 