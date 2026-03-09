using System.Diagnostics;
using GraphCalc.Api.Configuration;
using GraphCalc.Api.Infrastructure;
using Microsoft.Extensions.Options;

namespace GraphCalc.Api.Services;

public sealed class SolverQueueService
{
    private readonly SemaphoreSlim _concurrencySemaphore;
    private readonly ILogger<SolverQueueService> _logger;
    private readonly GraphCalcOptions _options;
    private int _queuedCount;
    private int _activeCount;

    public SolverQueueService(IOptions<GraphCalcOptions> options, ILogger<SolverQueueService> logger)
    {
        _options = options.Value;
        _logger = logger;
        _concurrencySemaphore = new SemaphoreSlim(_options.Solver.MaxConcurrency, _options.Solver.MaxConcurrency);
    }

    public int QueuedCount => Volatile.Read(ref _queuedCount);

    public int ActiveCount => Volatile.Read(ref _activeCount);

    public async Task<T> RunAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken cancellationToken)
    {
        var queued = Interlocked.Increment(ref _queuedCount);
        if (queued > _options.Solver.QueueLimit)
        {
            Interlocked.Decrement(ref _queuedCount);
            throw new ApiException(StatusCodes.Status429TooManyRequests, "Solver queue is full");
        }

        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(_options.Solver.RequestTimeoutSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
        var stopwatch = Stopwatch.StartNew();

        try
        {
            await _concurrencySemaphore.WaitAsync(linkedCts.Token);
            Interlocked.Decrement(ref _queuedCount);
            Interlocked.Increment(ref _activeCount);

            _logger.LogInformation(
                "Solver start queueDepth={QueueDepth} active={ActiveCount}",
                QueuedCount,
                ActiveCount);

            return await work(linkedCts.Token);
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            _logger.LogWarning(
                "Solver timed out queueDepth={QueueDepth} active={ActiveCount} durationMs={DurationMs}",
                QueuedCount,
                ActiveCount,
                stopwatch.ElapsedMilliseconds);
            throw new ApiException(StatusCodes.Status408RequestTimeout, "Solver timed out");
        }
        finally
        {
            if (_activeCount > 0)
            {
                Interlocked.Decrement(ref _activeCount);
                _concurrencySemaphore.Release();
            }

            _logger.LogInformation(
                "Solver finished queueDepth={QueueDepth} active={ActiveCount} durationMs={DurationMs}",
                QueuedCount,
                ActiveCount,
                stopwatch.ElapsedMilliseconds);
        }
    }
}
