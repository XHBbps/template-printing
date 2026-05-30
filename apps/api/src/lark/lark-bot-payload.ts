// 归一化 payload:WS(SDK parse 后扁平 targetData)与 HTTP(原始 {header,event})两形态各自映射到此。
// 见 docs/superpowers/specs/2026-05-29-lark-bot-longconn-design.md §2.1。

export interface NormalizedMessageEvent {
  eventId?: string;
  senderOpenId: string;
  senderType?: string;
  message: {
    messageId: string;
    chatId: string;
    chatType: 'group' | 'p2p';
    messageType: string;
    mentions: string[];
  };
}

export interface NormalizedCardAction {
  eventId?: string;
  operatorOpenId?: string;
  action: {
    value?: { sessionId?: string; action?: string; page?: number };
    name?: string;
    option?: string;
    inputValue?: string;
    formValue?: Record<string, unknown>;
  };
}

interface RawMessage {
  message_id: string;
  chat_id: string;
  chat_type: 'group' | 'p2p';
  message_type: string;
  mentions?: Array<{ id?: { open_id?: string } }>;
}
interface RawSender {
  sender_id?: { open_id?: string };
  sender_type?: string;
}
interface RawAction {
  value?: { sessionId?: string; action?: string; page?: number };
  name?: string;
  option?: string;
  input_value?: string;
  form_value?: Record<string, unknown>;
}

function normMessage(
  sender: RawSender | undefined,
  message: RawMessage,
  eventId?: string,
): NormalizedMessageEvent {
  return {
    eventId,
    senderOpenId: sender?.sender_id?.open_id ?? '',
    senderType: sender?.sender_type,
    message: {
      messageId: message.message_id,
      chatId: message.chat_id,
      chatType: message.chat_type,
      messageType: message.message_type,
      mentions: (message.mentions ?? [])
        .map((m) => m.id?.open_id)
        .filter((x): x is string => typeof x === 'string'),
    },
  };
}

function normAction(
  operator: { open_id?: string } | undefined,
  action: RawAction,
  eventId?: string,
): NormalizedCardAction {
  return {
    eventId,
    operatorOpenId: operator?.open_id,
    action: {
      value: action.value,
      name: action.name,
      option: action.option,
      inputValue: action.input_value,
      formValue: action.form_value,
    },
  };
}

export function fromWsMessage(d: Record<string, unknown>): NormalizedMessageEvent {
  return normMessage(
    d.sender as RawSender,
    d.message as RawMessage,
    d.event_id as string | undefined,
  );
}
export function fromWsCardAction(d: Record<string, unknown>): NormalizedCardAction {
  return normAction(
    d.operator as { open_id?: string } | undefined,
    d.action as RawAction,
    d.event_id as string | undefined,
  );
}
export function fromHttpMessage(b: {
  header?: Record<string, unknown>;
  event: { sender?: RawSender; message: RawMessage };
}): NormalizedMessageEvent {
  return normMessage(b.event.sender, b.event.message, b.header?.event_id as string | undefined);
}
export function fromHttpCardAction(b: {
  header?: Record<string, unknown>;
  event: { operator?: { open_id?: string }; action: RawAction };
}): NormalizedCardAction {
  return normAction(b.event.operator, b.event.action, b.header?.event_id as string | undefined);
}
