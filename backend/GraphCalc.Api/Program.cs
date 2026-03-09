using System.Diagnostics;
using System.Security.Cryptography.X509Certificates;
using System.Threading.RateLimiting;
using GraphCalc.Api.Auth;
using GraphCalc.Api.Configuration;
using GraphCalc.Api.Infrastructure;
using GraphCalc.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.Options;

public class Program
{
	public static async Task Main(string[] args)
	{
		var builder = WebApplication.CreateBuilder(args);
		var sharedConfigPath = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "config.json"));
		builder.Configuration.AddJsonFile(sharedConfigPath, optional: false, reloadOnChange: true);

		builder.Services
			.AddOptions<GraphCalcOptions>()
			.Bind(builder.Configuration)
			.ValidateDataAnnotations()
			.ValidateOnStart();

		var startupOptions = builder.Configuration.Get<GraphCalcOptions>()
		                     ?? throw new InvalidOperationException("backend/config.json could not be bound to GraphCalcOptions");
		var backendConfigDirectory = Path.GetDirectoryName(sharedConfigPath)
		                             ?? throw new InvalidOperationException("Could not resolve backend config directory");
		var certPath = Path.GetFullPath(Path.Combine(backendConfigDirectory, startupOptions.Server.Ssl.CertFile));
		var keyPath = Path.GetFullPath(Path.Combine(backendConfigDirectory, startupOptions.Server.Ssl.KeyFile));
		using var pemCertificate = X509Certificate2.CreateFromPemFile(certPath, keyPath);
		var serverCertificate = OperatingSystem.IsWindows()
			? X509CertificateLoader.LoadPkcs12(pemCertificate.Export(X509ContentType.Pfx), password: null)
			: pemCertificate;

		builder.WebHost.ConfigureKestrel(kestrel =>
		{
			kestrel.ListenLocalhost(startupOptions.Server.Port, listenOptions =>
			{
				listenOptions.UseHttps(serverCertificate);
			});
		});

		builder.Services.AddCors(options =>
		{
			options.AddPolicy("frontend", policy =>
			{
				policy.WithOrigins(startupOptions.Server.FrontendOrigins)
					.AllowAnyHeader()
					.AllowAnyMethod()
					.AllowCredentials();
			});
		});

		builder.Services.AddAuthentication(GraphCalcAuthenticationHandler.SchemeName)
			.AddScheme<AuthenticationSchemeOptions, GraphCalcAuthenticationHandler>(
				GraphCalcAuthenticationHandler.SchemeName,
				_ => { });
		builder.Services.AddAuthorization();
		builder.Services.AddControllers();
		builder.Services.AddEndpointsApiExplorer();
		builder.Services.AddSwaggerGen();

		builder.Services.AddSingleton<BackendStore>();
		builder.Services.AddSingleton<PasswordService>();
		builder.Services.AddSingleton<SessionTokenService>();
		builder.Services.AddSingleton<SessionCookieService>();
		builder.Services.AddSingleton<SolverQueueService>();
		builder.Services.AddSingleton<ISolverService, SolverService>();

		builder.Services.AddRateLimiter(options =>
		{
			options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
			options.OnRejected = async (context, cancellationToken) =>
			{
				context.HttpContext.Response.ContentType = "application/json";
				await context.HttpContext.Response.WriteAsJsonAsync(new { detail = "Too many requests" }, cancellationToken);
			};
			options.AddPolicy("auth", context =>
				RateLimitPartition.GetFixedWindowLimiter(
					$"auth:{GetIpKey(context)}",
					_ => new FixedWindowRateLimiterOptions
					{
						PermitLimit = startupOptions.RateLimiting.AuthRequestsPerMinute,
						Window = TimeSpan.FromMinutes(1),
						QueueLimit = 0,
						AutoReplenishment = true
					}));
			options.AddPolicy("global-authenticated", context =>
				RateLimitPartition.GetFixedWindowLimiter(
					$"global:{GetUserOrIpKey(context)}",
					_ => new FixedWindowRateLimiterOptions
					{
						PermitLimit = startupOptions.RateLimiting.GlobalRequestsPerMinute,
						Window = TimeSpan.FromMinutes(1),
						QueueLimit = 0,
						AutoReplenishment = true
					}));
			options.AddPolicy("solver", context =>
				RateLimitPartition.GetFixedWindowLimiter(
					$"solver:{GetUserOrIpKey(context)}",
					_ => new FixedWindowRateLimiterOptions
					{
						PermitLimit = startupOptions.RateLimiting.SolverRequestsPerMinute,
						Window = TimeSpan.FromMinutes(1),
						QueueLimit = 0,
						AutoReplenishment = true
					}));
		});

		var app = builder.Build();

		using (var scope = app.Services.CreateScope())
		{
			var store = scope.ServiceProvider.GetRequiredService<BackendStore>();
			await store.InitializeAsync(CancellationToken.None);
		}

		app.UseExceptionHandler(exceptionApp =>
		{
			exceptionApp.Run(async context =>
			{
				var feature = context.Features.Get<IExceptionHandlerFeature>();
				var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Errors");
				var error = feature?.Error;

				var (statusCode, detail) = error switch
				{
					ApiException apiException => (apiException.StatusCode, apiException.Detail),
					OperationCanceledException when context.RequestAborted.IsCancellationRequested => (499, "Request cancelled"),
					BadHttpRequestException badRequestException => (StatusCodes.Status400BadRequest, badRequestException.Message),
					_ => (StatusCodes.Status500InternalServerError, "Internal server error")
				};

				if (error is not null && statusCode >= 500)
				{
					logger.LogError(error, "Unhandled exception while processing {Method} {Path}", context.Request.Method, context.Request.Path);
				}

				context.Response.StatusCode = statusCode;
				context.Response.ContentType = "application/json";
				await context.Response.WriteAsJsonAsync(new { detail }, context.RequestAborted);
			});
		});

		app.Use(async (context, next) =>
		{
			var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Requests");
			var options = context.RequestServices.GetRequiredService<IOptions<GraphCalcOptions>>().Value;
			var stopwatch = Stopwatch.StartNew();

			await next();

			if (options.Server.LogRequests)
			{
				logger.LogInformation(
					"HTTP {Method} {Path} responded {StatusCode} origin={Origin} traceId={TraceId} durationMs={DurationMs}",
					context.Request.Method,
					context.Request.Path,
					context.Response.StatusCode,
					context.Request.Headers.Origin.ToString() is { Length: > 0 } origin ? origin : "-",
					Activity.Current?.TraceId.ToString() ?? context.TraceIdentifier,
					stopwatch.ElapsedMilliseconds);
			}
		});

		app.UseSwagger();
		app.UseSwaggerUI();
		app.UseCors("frontend");
		app.UseRateLimiter();
		app.UseAuthentication();
		app.UseAuthorization();

		app.MapControllers();

		app.Run();

		static string GetIpKey(HttpContext context)
		{
			return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
		}

		static string GetUserOrIpKey(HttpContext context)
		{
			var userId = context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
			return !string.IsNullOrWhiteSpace(userId) ? userId : GetIpKey(context);
		}
	}
}
