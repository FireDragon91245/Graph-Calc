using GraphCalc.Api.Configuration;
using Microsoft.Extensions.Options;

namespace GraphCalc.Api.Services;

public sealed class BackendCacheService : BackgroundService
{
    private readonly BackendStore _store;
    private readonly IOptionsMonitor<GraphCalcOptions> _optionsMonitor;
    private readonly ILogger<BackendCacheService> _logger;

    public BackendCacheService(BackendStore store, IOptionsMonitor<GraphCalcOptions> optionsMonitor, ILogger<BackendCacheService> logger)
    {
        _store = store;
        _optionsMonitor = optionsMonitor;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _store.RunCacheMaintenanceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Cache maintenance failed");
            }

            var sweepInterval = Math.Max(1, _optionsMonitor.CurrentValue.Caching.SweepIntervalSeconds);
            await Task.Delay(TimeSpan.FromSeconds(sweepInterval), stoppingToken);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await _store.FlushAllDirtyCacheAsync(cancellationToken);
        await base.StopAsync(cancellationToken);
    }
}