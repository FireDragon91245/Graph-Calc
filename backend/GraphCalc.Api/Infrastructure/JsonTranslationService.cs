using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GraphCalc.Api.Infrastructure;

public sealed partial class JsonTranslationService
{
    private readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> _resources;

    public JsonTranslationService(IHostEnvironment environment, ILogger<JsonTranslationService> logger)
    {
        var localeRoot = Path.Combine(environment.ContentRootPath, "locales");
        if (!Directory.Exists(localeRoot))
        {
            localeRoot = Path.Combine(AppContext.BaseDirectory, "locales");
        }

        var resources = new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var language in new[] { "en", "de" })
        {
            var path = Path.Combine(localeRoot, language, "translation.json");
            if (!File.Exists(path))
            {
                logger.LogWarning("Translation file {TranslationFile} was not found", path);
                continue;
            }

            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            Flatten(document.RootElement, string.Empty, values);
            resources[language] = values;
        }

        _resources = resources;
    }

    public string Translate(string key, IReadOnlyDictionary<string, object?>? args = null)
    {
        var language = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        var value = Find(language, key) ?? Find("en", key) ?? key;
        if (args is null || args.Count == 0) return value;

        return InterpolationPattern().Replace(value, match =>
        {
            var name = match.Groups[1].Value;
            return args.TryGetValue(name, out var argument)
                ? Convert.ToString(argument, CultureInfo.CurrentCulture) ?? string.Empty
                : match.Value;
        });
    }

    private string? Find(string language, string key) =>
        _resources.TryGetValue(language, out var resource) && resource.TryGetValue(key, out var value) ? value : null;

    private static void Flatten(JsonElement element, string prefix, IDictionary<string, string> values)
    {
        if (element.ValueKind == JsonValueKind.String)
        {
            values[prefix] = element.GetString() ?? string.Empty;
            return;
        }

        if (element.ValueKind != JsonValueKind.Object) return;
        foreach (var property in element.EnumerateObject())
        {
            var key = string.IsNullOrEmpty(prefix) ? property.Name : $"{prefix}.{property.Name}";
            Flatten(property.Value, key, values);
        }
    }

    [GeneratedRegex(@"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")]
    private static partial Regex InterpolationPattern();
}
