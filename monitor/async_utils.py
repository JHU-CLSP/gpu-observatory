"""Wait for owned database work before releasing resources on cancellation."""
from __future__ import annotations

import asyncio
import contextvars
import functools


async def finish_before_cancelling(awaitable):
    task = asyncio.ensure_future(awaitable)
    cancelled = False
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError:
            cancelled = True
            if task.done():
                if not task.cancelled():
                    task.exception()
                raise
    if cancelled:
        raise asyncio.CancelledError
    return result


async def run_in_thread(func, *args, **kwargs):
    context = contextvars.copy_context()
    future = asyncio.get_running_loop().run_in_executor(
        None, functools.partial(context.run, func, *args, **kwargs)
    )
    return await finish_before_cancelling(future)
