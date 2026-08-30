"""
RabbitMQ service for payment retry queue.

On payment failure + user consent to retry (Gate 3), push a retry job to the queue.
A consumer picks it up, re-attempts the payment, and reports the result back.

Retry cap: MAX_RETRY_ATTEMPTS (default 2) — enforced by the orchestrator state.
"""
import json
import asyncio
from typing import Optional, Callable
import aio_pika
from aio_pika import Message, DeliveryMode
from app.config import get_settings
import structlog

logger = structlog.get_logger()
settings = get_settings()

_connection: Optional[aio_pika.abc.AbstractConnection] = None
_channel: Optional[aio_pika.abc.AbstractChannel] = None


async def get_rabbitmq_connection() -> aio_pika.abc.AbstractConnection:
    global _connection
    if _connection is None or _connection.is_closed:
        _connection = await aio_pika.connect_robust(settings.RABBITMQ_URL)
    return _connection


async def get_rabbitmq_channel() -> aio_pika.abc.AbstractChannel:
    global _channel
    conn = await get_rabbitmq_connection()
    if _channel is None or _channel.is_closed:
        _channel = await conn.channel()
        await _channel.set_qos(prefetch_count=1)
    return _channel


async def ensure_retry_queue():
    """Declare the retry queue (idempotent)."""
    channel = await get_rabbitmq_channel()
    await channel.declare_queue(
        settings.RABBITMQ_RETRY_QUEUE,
        durable=True,
    )
    logger.info("rabbitmq_queue_ready", queue=settings.RABBITMQ_RETRY_QUEUE)


async def publish_retry_job(session_id: str, cart: list[dict], retry_count: int, amount: float):
    """
    Push a payment retry job to the RabbitMQ queue.

    Payload:
    {
        "session_id": str,
        "cart": list[dict],
        "retry_count": int,   # how many retries have happened so far
        "amount": float,
    }
    """
    channel = await get_rabbitmq_channel()
    await channel.declare_queue(settings.RABBITMQ_RETRY_QUEUE, durable=True)

    payload = {
        "session_id": session_id,
        "cart": cart,
        "retry_count": retry_count,
        "amount": amount,
    }

    message = Message(
        body=json.dumps(payload).encode(),
        delivery_mode=DeliveryMode.PERSISTENT,
        content_type="application/json",
    )

    await channel.default_exchange.publish(
        message,
        routing_key=settings.RABBITMQ_RETRY_QUEUE,
    )

    logger.info(
        "retry_job_published",
        session_id=session_id,
        retry_count=retry_count,
        amount=amount,
    )


async def start_retry_consumer(callback: Callable):
    """
    Start consuming retry jobs from RabbitMQ.
    callback(session_id, cart, retry_count, amount) will be called for each job.
    """
    channel = await get_rabbitmq_channel()
    queue = await channel.declare_queue(settings.RABBITMQ_RETRY_QUEUE, durable=True)

    async def on_message(message: aio_pika.abc.AbstractIncomingMessage):
        async with message.process():
            try:
                payload = json.loads(message.body.decode())
                logger.info(
                    "retry_job_received",
                    session_id=payload.get("session_id"),
                    retry_count=payload.get("retry_count"),
                )
                await callback(
                    payload["session_id"],
                    payload["cart"],
                    payload["retry_count"],
                    payload["amount"],
                )
            except Exception as e:
                logger.error("retry_consumer_error", error=str(e))

    await queue.consume(on_message)
    logger.info("retry_consumer_started", queue=settings.RABBITMQ_RETRY_QUEUE)


async def close_rabbitmq():
    global _connection, _channel
    if _channel and not _channel.is_closed:
        await _channel.close()
    if _connection and not _connection.is_closed:
        await _connection.close()
    _connection = None
    _channel = None
